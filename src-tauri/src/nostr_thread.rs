use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::mpsc::Receiver;
use nostrdb::{Ndb, Config, Subscription};
use enostr::{RelayPool, ewebsock};
use tauri::Emitter;
use tracing::{debug, info, warn, error};
use crate::nostr_types::{NostrRequest, NostrResponse, RelayStatusInfo};
use crate::relay_handlers;
use crate::subscription_handlers;

thread_local! {
    static NDB: RefCell<Option<Ndb>> = RefCell::new(None);
    static POOL: RefCell<Option<RelayPool>> = RefCell::new(None);
    static SUBSCRIPTIONS: RefCell<HashMap<String, Subscription>> = RefCell::new(HashMap::new());
    static SUB_ID_MAP: RefCell<HashMap<u64, String>> = RefCell::new(HashMap::new());
    /// Active relay subscription filters, replayed when new relays connect
    static ACTIVE_RELAY_SUBS: RefCell<HashMap<String, Vec<nostrdb::Filter>>> = RefCell::new(HashMap::new());
}

pub fn nostr_thread(rx: &Receiver<NostrRequest>, db_path: &str, app_handle: tauri::AppHandle) {
    info!(target: "iris", "Initializing nostrdb and relay pool");
    let config = Config::new();
    let ndb = Ndb::new(&db_path, &config).expect("failed to initialize nostrdb");
    let mut pool = RelayPool::new();

    // Add multicast relay for local network discovery (WebRTC signaling)
    let wakeup = || {}; // No-op wakeup
    match enostr::PoolRelay::multicast(wakeup) {
        Ok(multicast_relay) => {
            pool.relays.push(multicast_relay);
            info!("Multicast relay enabled for local network discovery");
        }
        Err(e) => {
            warn!(error = ?e, "Failed to setup multicast relay");
        }
    }

    NDB.with(|n| *n.borrow_mut() = Some(ndb));
    POOL.with(|p| *p.borrow_mut() = Some(pool));

    loop {
        let mut had_activity = false;

        // Process relay events, collect newly opened relays for deferred subscription replay
        let mut newly_opened_relays: Vec<String> = Vec::new();

        POOL.with(|p| {
            if let Some(pool) = p.borrow_mut().as_mut() {
                while let Some(pool_event) = pool.try_recv() {
                    had_activity = true;
                    let relay_url = pool_event.relay;
                    let event = pool_event.event;

                    match event {
                        ewebsock::WsEvent::Message(ewebsock::WsMessage::Text(text)) => {
                            // Fast path: check for duplicate EVENT messages using string ops
                            let mut already_had = false;
                            if text.len() > 3 && text.as_bytes()[2] == b'E' && text.as_bytes()[3] == b'V' {
                                if let Some(id_pos) = text.find(r#""id":""#) {
                                    let id_start = id_pos + 6;
                                    let id_end = id_start + 64;
                                    if id_end <= text.len() {
                                        let id_str = &text[id_start..id_end];
                                        let mut id_bytes = [0u8; 32];
                                        if hex::decode_to_slice(id_str, &mut id_bytes).is_ok() {
                                            NDB.with(|n| {
                                                if let Some(ndb) = n.borrow().as_ref() {
                                                    if let Ok(txn) = nostrdb::Transaction::new(ndb) {
                                                        already_had = ndb.get_notekey_by_id(&txn, &id_bytes).is_ok();
                                                    }
                                                }
                                            });
                                        }
                                    }
                                }
                            }

                            // Skip if already had - don't process or forward
                            if already_had {
                                continue;
                            }

                            debug!(relay = %relay_url, len = text.len(), "Received message");

                            // Process through nostrdb (validates signature)
                            NDB.with(|n| {
                                if let Some(ndb) = n.borrow_mut().as_mut() {
                                    // Try to parse as relay message first
                                    if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
                                        if let Some(arr) = msg.as_array() {
                                            match arr.get(0).and_then(|v| v.as_str()) {
                                                Some("EVENT") if arr.len() >= 3 => {
                                                    // Validate with nostrdb
                                                    match ndb.process_event(&text) {
                                                        Ok(_) => {
                                                            if let (Some(sub_id), Some(event)) = (arr[1].as_str(), arr.get(2)) {
                                                                let _ = app_handle.emit("nostr_event", NostrResponse::Event {
                                                                    sub_id: sub_id.to_string(),
                                                                    event: event.clone(),
                                                                    relay: Some(relay_url.to_string()),
                                                                });
                                                            }
                                                        }
                                                        Err(e) => {
                                                            warn!(error = ?e, "Event rejected");
                                                        }
                                                    }
                                                }
                                                Some("NOTICE") if arr.len() >= 2 => {
                                                    if let Some(notice) = arr[1].as_str() {
                                                        warn!(relay = %relay_url, notice = %notice, "Relay notice");
                                                    }
                                                }
                                                Some("EOSE") if arr.len() >= 2 => {
                                                    if let Some(sub_id) = arr[1].as_str() {
                                                        debug!(relay = %relay_url, sub_id = %sub_id, "End of stored events (not forwarding to frontend)");
                                                    }
                                                }
                                                Some("OK") => {
                                                    debug!(relay = %relay_url, "Event accepted");
                                                }
                                                _ => {
                                                    debug!(relay = %relay_url, msg = %&text[..text.len().min(100)], "Unknown message");
                                                }
                                            }
                                        }
                                    }
                                }
                            });
                        }
                        ewebsock::WsEvent::Opened => {
                            info!(relay = %relay_url, "Relay connection opened");
                            newly_opened_relays.push(relay_url.to_string());
                            let _ = app_handle.emit("nostr_event", serde_json::json!({
                                "type": "relayConnected",
                                "relay": relay_url
                            }));
                        }
                        ewebsock::WsEvent::Closed => {
                            info!(relay = %relay_url, "Disconnected");
                            let _ = app_handle.emit("nostr_event", serde_json::json!({
                                "type": "relayDisconnected",
                                "relay": relay_url
                            }));
                        }
                        ewebsock::WsEvent::Error(e) => {
                            error!(relay = %relay_url, error = %e, "Relay error");
                        }
                        _ => {
                            // Ignore other message types (Binary, Ping, Pong, Unknown)
                        }
                    }
                }
            }
        });

        // Replay active subscriptions to newly opened relays (deferred to avoid borrow conflict)
        if !newly_opened_relays.is_empty() {
            POOL.with(|p| {
                ACTIVE_RELAY_SUBS.with(|active| {
                    if let Some(pool) = p.borrow_mut().as_mut() {
                        let active_subs = active.borrow();
                        for relay_url in &newly_opened_relays {
                            subscription_handlers::replay_subscriptions_to_relay(
                                &active_subs,
                                pool,
                                relay_url,
                            );
                        }
                    }
                });
            });
        }

        // Process commands
        match rx.try_recv() {
            Ok(NostrRequest::Init) => {
                had_activity = true;
                let _ = app_handle.emit("nostr_event", NostrResponse::Ready);
            }
            Ok(NostrRequest::AddRelay { url }) => {
                had_activity = true;
                POOL.with(|p| {
                    ACTIVE_RELAY_SUBS.with(|active| {
                        if let Some(pool) = p.borrow_mut().as_mut() {
                            relay_handlers::handle_add_relay(pool, url.clone(), &app_handle);
                            // Replay active subscriptions to the new relay
                            let active_subs = active.borrow();
                            subscription_handlers::replay_subscriptions_to_relay(
                                &active_subs,
                                pool,
                                &url,
                            );
                        }
                    });
                });
            }
            Ok(NostrRequest::GetRelayStatus { id }) => {
                had_activity = true;
                debug!(id = %id, "GetRelayStatus request");
                POOL.with(|p| {
                    if let Some(pool) = p.borrow().as_ref() {
                        debug!(count = pool.relays.len(), "Relay pool status");
                        let statuses: Vec<RelayStatusInfo> = pool.relays.iter().map(|relay| {
                            let url = relay.url().to_string();
                            let enostr_status = relay.status();
                            // Map to NDK status values: CONNECTED=5, CONNECTING=4, DISCONNECTED=1
                            let ndk_status = match enostr_status {
                                enostr::RelayStatus::Connected => 5,
                                enostr::RelayStatus::Connecting => 4,
                                enostr::RelayStatus::Disconnected => 1,
                            };
                            debug!(relay = %url, enostr_status = ?enostr_status, ndk_status = ndk_status, "Relay status");
                            RelayStatusInfo {
                                url,
                                status: ndk_status,
                            }
                        }).collect();

                        debug!(count = statuses.len(), "Emitting relay status");
                        let _ = app_handle.emit("nostr_event", NostrResponse::RelayStatus {
                            id,
                            relay_statuses: statuses,
                        });
                    }
                });
            }
            Ok(NostrRequest::Subscribe { id, filters, subscribe_opts }) => {
                had_activity = true;
                NDB.with(|n| {
                    POOL.with(|p| {
                        SUBSCRIPTIONS.with(|subs| {
                            SUB_ID_MAP.with(|map| {
                                ACTIVE_RELAY_SUBS.with(|active| {
                                    if let (Some(ndb), Some(pool)) = (n.borrow().as_ref(), p.borrow_mut().as_mut()) {
                                        subscription_handlers::handle_subscribe(
                                            id,
                                            filters,
                                            subscribe_opts,
                                            ndb,
                                            pool,
                                            &mut subs.borrow_mut(),
                                            &mut map.borrow_mut(),
                                            &mut active.borrow_mut(),
                                            &app_handle,
                                        );
                                    }
                                });
                            });
                        });
                    });
                });
            }
            Ok(NostrRequest::Publish { id, event, publish_opts }) => {
                had_activity = true;
                NDB.with(|n| {
                    POOL.with(|p| {
                        if let (Some(ndb), Some(pool)) = (n.borrow().as_ref(), p.borrow_mut().as_mut()) {
                            subscription_handlers::handle_publish(id, event, publish_opts, ndb, pool, &app_handle);
                        }
                    });
                });
            }
            Ok(NostrRequest::Unsubscribe { id }) => {
                had_activity = true;
                POOL.with(|p| {
                    SUBSCRIPTIONS.with(|subs| {
                        ACTIVE_RELAY_SUBS.with(|active| {
                            if let Some(pool) = p.borrow_mut().as_mut() {
                                subscription_handlers::handle_unsubscribe(id, pool, &mut subs.borrow_mut(), &mut active.borrow_mut());
                            }
                        });
                    });
                });
            }
            Ok(NostrRequest::RemoveRelay { url }) => {
                had_activity = true;
                POOL.with(|p| {
                    if let Some(pool) = p.borrow_mut().as_mut() {
                        relay_handlers::handle_remove_relay(pool, url);
                    }
                });
            }
            Ok(NostrRequest::ConnectRelay { url }) => {
                had_activity = true;
                POOL.with(|p| {
                    if let Some(pool) = p.borrow_mut().as_mut() {
                        relay_handlers::handle_connect_relay(pool, url);
                    }
                });
            }
            Ok(NostrRequest::DisconnectRelay { url }) => {
                had_activity = true;
                POOL.with(|p| {
                    if let Some(pool) = p.borrow_mut().as_mut() {
                        relay_handlers::handle_disconnect_relay(pool, url);
                    }
                });
            }
            Ok(NostrRequest::ReconnectDisconnected { reason }) => {
                had_activity = true;
                POOL.with(|p| {
                    if let Some(pool) = p.borrow_mut().as_mut() {
                        relay_handlers::handle_reconnect_disconnected(pool, reason);
                    }
                });
            }
            Ok(NostrRequest::GetStats { id }) => {
                had_activity = true;
                use crate::nostr_types::LocalDataStats;
                use std::collections::HashMap;

                // nostrdb doesn't expose count API directly - return zeros for now
                // Can be improved later with ndb_stat bindings
                let stats = LocalDataStats {
                    total_events: 0,
                    events_by_kind: HashMap::new(),
                };

                let _ = app_handle.emit("nostr_event", NostrResponse::Stats {
                    id: id.clone(),
                    stats
                });
            }
            Ok(NostrRequest::Close) => {
                info!("Close command received");
                break;
            }
            Err(std::sync::mpsc::TryRecvError::Empty) => {},
            Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
        }

        // Sleep when idle to reduce CPU usage
        if !had_activity {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
}
