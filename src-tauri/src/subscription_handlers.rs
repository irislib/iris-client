use std::collections::HashMap;
use nostrdb::{Ndb, Filter, Subscription, Transaction};
use enostr::{RelayPool, ClientMessage};
use tauri::Emitter;
use tracing::{debug, info, warn, error};
use crate::nostr_types::{NostrResponse, SubscribeOpts, PublishOpts};
use crate::filter_parser::parse_filter;

pub fn handle_subscribe(
    id: String,
    filters: Vec<serde_json::Value>,
    subscribe_opts: Option<SubscribeOpts>,
    ndb: &Ndb,
    pool: &mut RelayPool,
    subscriptions: &mut HashMap<String, Subscription>,
    sub_id_map: &mut HashMap<u64, String>,
    active_relay_subs: &mut HashMap<String, Vec<Filter>>,
    _app_handle: &tauri::AppHandle,
) {
    info!(sub_id = %id, filter_count = filters.len(), "Subscribe request");

    // Parse JSON filters
    let parsed_filters: Vec<Filter> = filters
        .iter()
        .filter_map(|f| parse_filter(f))
        .collect();

    if parsed_filters.is_empty() {
        warn!(sub_id = %id, "No valid filters");
        return;
    }

    // Check if cache-only
    let cache_only = subscribe_opts
        .as_ref()
        .and_then(|opts| opts.destinations.as_ref())
        .map(|dests| dests.contains(&"cache".to_string()) && !dests.contains(&"relay".to_string()))
        .unwrap_or(false);

    let filter = parsed_filters[0].clone();

    // Check if this is an ID-based query (check without consuming iterator)
    let is_id_query = filter.clone().into_iter().any(|field| matches!(field, nostrdb::FilterField::Ids(_)));

    // Subscribe in nostrdb (skip for ID queries - we handle them via direct lookup)
    if !is_id_query {
        match ndb.subscribe(&[filter.clone()]) {
            Ok(sub) => {
                let ndb_id = sub.id();
                subscriptions.insert(id.clone(), sub);
                sub_id_map.insert(ndb_id, id.clone());
                info!(sub_id = %id, ndb_id = ndb_id, "Created nostrdb subscription");
            }
            Err(e) => {
                error!(sub_id = %id, error = ?e, active_subs = subscriptions.len(), "Nostrdb subscribe failed");
            }
        }
    } else {
        info!(sub_id = %id, "Skipping nostrdb subscription for ID query");
    }

    // Query cache and determine what to fetch from relays (single cache pass)
    let mut relay_filters = parsed_filters.clone();
    let mut skip_relay_req = cache_only;

    if let Ok(txn) = Transaction::new(ndb) {
        // Check if this is an ID-based query
        let has_ids = filter.into_iter().any(|field| matches!(field, nostrdb::FilterField::Ids(_)));

        if has_ids {
            // Fast path: direct ID lookup, emit found events, track unfound IDs for relay REQ
            let mut emitted = 0;
            let mut unfound_ids = Vec::new();

            for field in filter.into_iter() {
                if let nostrdb::FilterField::Ids(ids) = field {
                    for id_bytes in ids.into_iter() {
                        if let Ok(note_key) = ndb.get_notekey_by_id(&txn, id_bytes) {
                            if let Ok(note) = ndb.get_note_by_key(&txn, note_key) {
                                if let Ok(event_json) = note.json() {
                                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(&event_json) {
                                        let _ = _app_handle.emit("nostr_event", NostrResponse::Event {
                                            sub_id: id.clone(),
                                            event,
                                            relay: None,
                                        });
                                        emitted += 1;
                                    }
                                }
                            }
                        } else {
                            unfound_ids.push(*id_bytes);
                        }
                    }
                }
            }


            // Skip relay REQ if all IDs found
            if unfound_ids.is_empty() {
                skip_relay_req = true;
            } else if emitted > 0 {
                // Update relay filters to only request unfound IDs
                relay_filters = vec![nostrdb::Filter::new().ids(unfound_ids.iter()).build()];
            }
        } else {
            // Slow path: full query for non-ID filters
            let mut emitted = 0;
            if let Ok(results) = ndb.query(&txn, &[filter.clone()], 1000) {
                for result in results.iter() {
                    if let Ok(event_json) = result.note.json() {
                        if let Ok(event) = serde_json::from_str::<serde_json::Value>(&event_json) {
                            let _ = _app_handle.emit("nostr_event", NostrResponse::Event {
                                sub_id: id.clone(),
                                event,
                                relay: None,
                            });
                            emitted += 1;
                        }
                    }
                }
            }
            if emitted > 0 {
                debug!(sub_id = %id, count = emitted, "Emitted cached events");
            }
        }
    }

    // Skip relay REQ if all events found in cache
    if skip_relay_req {
        debug!(sub_id = %id, "All events in cache - skipping relay REQ and EOSE");
        return;
    }

    // Store for replay on new relay connections
    active_relay_subs.insert(id.clone(), relay_filters.clone());

    // Use pool.subscribe() which handles negentropy for eligible filters
    pool.subscribe(id.clone(), relay_filters);
    info!(sub_id = %id, relay_count = pool.relays.len(), "Subscribed to relays (with negentropy if eligible)");
}

pub fn handle_unsubscribe(
    id: String,
    pool: &mut RelayPool,
    subscriptions: &mut HashMap<String, Subscription>,
    active_relay_subs: &mut HashMap<String, Vec<Filter>>,
) {
    subscriptions.remove(&id);
    active_relay_subs.remove(&id);
    let close_msg = ClientMessage::close(id.clone());
    pool.send(&close_msg);
    debug!(sub_id = %id, "Sent CLOSE to relays");
}

/// Replay all active subscriptions to a specific relay (used when a new relay connects)
pub fn replay_subscriptions_to_relay(
    active_relay_subs: &HashMap<String, Vec<Filter>>,
    pool: &mut RelayPool,
    relay_url: &str,
) {
    let count = active_relay_subs.len();
    if count == 0 {
        return;
    }
    for (sub_id, filters) in active_relay_subs {
        pool.send_to(&ClientMessage::req(sub_id.clone(), filters.clone()), relay_url);
    }
    info!(count = count, relay = %relay_url, "Replayed subscriptions to new relay");
}

pub fn handle_publish(
    id: String,
    event: serde_json::Value,
    publish_opts: Option<PublishOpts>,
    ndb: &Ndb,
    pool: &mut RelayPool,
    app_handle: &tauri::AppHandle,
) {
    let destinations = publish_opts
        .as_ref()
        .and_then(|opts| opts.publish_to.as_ref())
        .map(|v| v.clone())
        .unwrap_or_else(|| vec!["relay".to_string()]);

    let event_json = serde_json::to_string(&event).unwrap_or_default();

    // Dispatch to local subscriptions (WebRTC events from untrusted sources)
    if destinations.contains(&"subscriptions".to_string()) {
        if let Some(source) = publish_opts.as_ref().and_then(|o| o.source.as_ref()) {
            debug!(source = %source, event_id = ?event.get("id"), "Dispatching to local subscriptions");
        }

        // Process through nostrdb (validates + stores + dispatches to subs)
        let _ = ndb.process_event(&event_json);
    }

    // Publish to relays if requested
    if destinations.contains(&"relay".to_string()) {
        match ClientMessage::event_json(event_json) {
            Ok(msg) => {
                pool.send(&msg);
                info!(pub_id = %id, relay_count = pool.relays.len(), "Published to relays/multicast");
                let _ = app_handle.emit("nostr_event", NostrResponse::Published { id });
            }
            Err(e) => {
                error!(pub_id = %id, error = ?e, "Invalid event");
                let _ = app_handle.emit("nostr_event", NostrResponse::Error {
                    id: Some(id),
                    error: format!("Invalid event: {:?}", e),
                });
            }
        }
    } else {
        // Not publishing to relays, but ack success
        let _ = app_handle.emit("nostr_event", NostrResponse::Published { id });
    }
}
