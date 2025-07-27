// This file now only manages user/device relationships and sessionId references
// Actual sessions are managed by the sessions store
export interface DeviceRecord {
  deviceId: string
  activeSessionId?: string // Reference to session in sessions store
  inactiveSessionIds: string[] // References to sessions in sessions store
  isStale: boolean
  staleTimestamp?: number
  lastActivity?: number
}

/**
 * Manages user/device relationships and session references
 * Actual sessions are stored in the sessions store
 * Structure: UserRecord → DeviceRecord → sessionId references
 */
export class UserRecord {
  private deviceRecords: Map<string, DeviceRecord> = new Map()
  private isStale: boolean = false
  private staleTimestamp?: number

  constructor(
    public readonly userId: string,
    public readonly publicKey: string
  ) {}

  // ============================================================================
  // Device Management
  // ============================================================================

  /**
   * Creates or updates a device record for this user
   */
  public upsertDevice(deviceId: string): DeviceRecord {
    let record = this.deviceRecords.get(deviceId)

    if (!record) {
      record = {
        deviceId,
        inactiveSessionIds: [],
        isStale: false,
        lastActivity: Date.now(),
      }
      this.deviceRecords.set(deviceId, record)
    }

    return record
  }

  /**
   * Gets a device record by deviceId
   */
  public getDevice(deviceId: string): DeviceRecord | undefined {
    return this.deviceRecords.get(deviceId)
  }

  /**
   * Gets all device records for this user
   */
  public getAllDevices(): DeviceRecord[] {
    return Array.from(this.deviceRecords.values())
  }

  /**
   * Gets all active (non-stale) device records
   */
  public getActiveDevices(): DeviceRecord[] {
    if (this.isStale) return []
    return Array.from(this.deviceRecords.values()).filter((device) => !device.isStale)
  }

  /**
   * Removes a device record
   */
  public removeDevice(deviceId: string): boolean {
    return this.deviceRecords.delete(deviceId)
  }

  // ============================================================================
  // Session Reference Management
  // ============================================================================

  /**
   * Associates a sessionId with a device
   */
  public upsertSession(deviceId: string, sessionId: string): void {
    const device = this.upsertDevice(deviceId)

    // If there's an active session, move it to inactive
    if (device.activeSessionId) {
      device.inactiveSessionIds.unshift(device.activeSessionId)
    }

    // Set the new session as active
    device.activeSessionId = sessionId
    device.lastActivity = Date.now()
  }

  /**
   * Gets the active sessionId for a specific device
   */
  public getActiveSessionId(deviceId: string): string | undefined {
    const device = this.deviceRecords.get(deviceId)
    return device?.isStale ? undefined : device?.activeSessionId
  }

  /**
   * Gets all sessionIds (active + inactive) for a specific device
   */
  public getDeviceSessionIds(deviceId: string): string[] {
    const device = this.deviceRecords.get(deviceId)
    if (!device) return []

    const sessionIds: string[] = []
    if (device.activeSessionId) {
      sessionIds.push(device.activeSessionId)
    }
    sessionIds.push(...device.inactiveSessionIds)
    return sessionIds
  }

  /**
   * Gets all active sessionIds across all devices for this user
   */
  public getActiveSessionIds(): string[] {
    const sessionIds: string[] = []

    for (const device of this.getActiveDevices()) {
      if (device.activeSessionId) {
        sessionIds.push(device.activeSessionId)
      }
    }

    return sessionIds
  }

  /**
   * Gets all sessionIds (active + inactive) across all devices
   */
  public getAllSessionIds(): string[] {
    const sessionIds: string[] = []

    for (const device of this.deviceRecords.values()) {
      if (device.activeSessionId) {
        sessionIds.push(device.activeSessionId)
      }
      sessionIds.push(...device.inactiveSessionIds)
    }

    return sessionIds
  }

  /**
   * Gets sessionIds in the format used by iris-client (userPubKey:deviceId)
   */
  public getSessionIds(): string[] {
    const sessionIds: string[] = []

    for (const device of this.getActiveDevices()) {
      if (device.activeSessionId) {
        sessionIds.push(device.activeSessionId)
      }
    }

    return sessionIds
  }

  // ============================================================================
  // Compatibility Methods (using sessionIds instead of Session objects)
  // ============================================================================

  /**
   * Gets the active sessionId for a specific device (compatibility method)
   */
  public getActiveSession(deviceId: string): string | undefined {
    return this.getActiveSessionId(deviceId)
  }

  /**
   * Checks if this user has any active sessions (by checking sessionIds)
   */
  public hasActiveSessions(): boolean {
    return this.getActiveSessionIds().length > 0
  }

  // ============================================================================
  // Stale Management
  // ============================================================================

  /**
   * Marks a specific device as stale
   */
  public markDeviceStale(deviceId: string): void {
    const device = this.deviceRecords.get(deviceId)
    if (device) {
      device.isStale = true
      device.staleTimestamp = Date.now()
    }
  }

  /**
   * Marks the entire user record as stale
   */
  public markUserStale(): void {
    this.isStale = true
    this.staleTimestamp = Date.now()
  }

  /**
   * Removes stale devices older than maxLatency
   */
  public pruneStaleRecords(maxLatency: number): void {
    const now = Date.now()

    // Remove stale devices
    for (const [deviceId, device] of this.deviceRecords.entries()) {
      if (
        device.isStale &&
        device.staleTimestamp &&
        now - device.staleTimestamp > maxLatency
      ) {
        this.removeDevice(deviceId)
      }
    }

    // Mark entire user record for removal if stale
    if (this.isStale && this.staleTimestamp && now - this.staleTimestamp > maxLatency) {
      this.deviceRecords.clear()
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Gets the most recently active device
   */
  public getMostActiveDevice(): DeviceRecord | undefined {
    const activeDevices = this.getActiveDevices()
    if (activeDevices.length === 0) return undefined

    return activeDevices.reduce((most, current) => {
      const mostActivity = most.lastActivity || 0
      const currentActivity = current.lastActivity || 0
      return currentActivity > mostActivity ? current : most
    })
  }

  /**
   * Gets the preferred sessionId (from most active device)
   */
  public getPreferredSessionId(): string | null {
    const mostActive = this.getMostActiveDevice()
    return mostActive?.activeSessionId || null
  }

  /**
   * Gets total count of devices
   */
  public getDeviceCount(): number {
    return this.deviceRecords.size
  }

  /**
   * Gets total count of active sessions
   */
  public getActiveSessionCount(): number {
    return this.getActiveSessionIds().length
  }

  /**
   * Updates last activity for a device
   */
  public updateDeviceActivity(deviceId: string): void {
    const device = this.deviceRecords.get(deviceId)
    if (device) {
      device.lastActivity = Date.now()
    }
  }

  /**
   * Removes a session reference from a specific device
   */
  public deleteSession(deviceId: string): void {
    const device = this.deviceRecords.get(deviceId)
    if (device && device.activeSessionId) {
      // Move active session to inactive
      device.inactiveSessionIds.unshift(device.activeSessionId)
      device.activeSessionId = undefined

      // If there are inactive sessions, activate the most recent one
      if (device.inactiveSessionIds.length > 1) {
        device.activeSessionId = device.inactiveSessionIds.shift()
      }
    }
  }

  /**
   * Gets total number of session references across all devices
   */
  public getTotalSessionCount(): number {
    return this.getAllSessionIds().length
  }

  // ============================================================================
  // Serialization (No session data, just device metadata and sessionId references)
  // ============================================================================

  /**
   * Serializes the UserRecord for persistence (excluding session data)
   */
  public serialize(): string {
    const data = {
      userId: this.userId,
      publicKey: this.publicKey,
      isStale: this.isStale,
      staleTimestamp: this.staleTimestamp,
      devices: Array.from(this.deviceRecords.values()).map((device) => ({
        deviceId: device.deviceId,
        isStale: device.isStale,
        staleTimestamp: device.staleTimestamp,
        lastActivity: device.lastActivity,
        activeSessionId: device.activeSessionId,
        inactiveSessionIds: device.inactiveSessionIds,
      })),
    }
    return JSON.stringify(data)
  }

  /**
   * Deserializes the UserRecord from persistence (no session reconstruction)
   */
  public deserialize(serializedData: string): void {
    const data = JSON.parse(serializedData)
    this.isStale = data.isStale || false
    this.staleTimestamp = data.staleTimestamp

    this.deviceRecords.clear()

    data.devices?.forEach(
      (deviceData: {
        deviceId: string
        isStale?: boolean
        staleTimestamp?: number
        lastActivity?: number
        activeSessionId?: string
        inactiveSessionIds?: string[]
      }) => {
        const device: DeviceRecord = {
          deviceId: deviceData.deviceId,
          isStale: deviceData.isStale || false,
          staleTimestamp: deviceData.staleTimestamp,
          lastActivity: deviceData.lastActivity,
          activeSessionId: deviceData.activeSessionId,
          inactiveSessionIds: deviceData.inactiveSessionIds || [],
        }

        this.deviceRecords.set(device.deviceId, device)
      }
    )
  }

  /**
   * Cleanup when destroying the user record
   */
  public close(): void {
    this.deviceRecords.clear()
  }

  // ============================================================================
  // Iris-Client Integration Methods
  // ============================================================================

  /**
   * Creates session ID from device ID (for iris-client compatibility)
   */
  public createSessionId(deviceId: string): string {
    return `${this.userId}:${deviceId}`
  }

  /**
   * Parses session ID to get device ID
   */
  public static parseSessionId(sessionId: string): {
    userPubKey: string
    deviceId: string
  } {
    const [userPubKey, deviceId] = sessionId.split(":")
    return {userPubKey, deviceId: deviceId || "unknown"}
  }

  // ============================================================================
  // Legacy Compatibility (for gradual migration)
  // ============================================================================

  /**
   * @deprecated Use upsertDevice instead
   */
  public conditionalUpdate(deviceId: string): void {
    this.upsertDevice(deviceId)
  }

  /**
   * Legacy method for compatibility with existing code
   */
  public upsertSessionLegacy(sessionId: string): void {
    const {deviceId} = UserRecord.parseSessionId(sessionId)
    this.upsertSession(deviceId, sessionId)
  }
}
