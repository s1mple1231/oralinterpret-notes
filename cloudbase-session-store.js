export class CloudBaseSessionStore {
  constructor({
    getSdkModule = async () => import("@cloudbase/node-sdk"),
    createSessionState,
    envId,
    collection = "interpreting_sessions",
    ttlMs,
    restoreSessionFromSnapshot,
    createSessionSnapshot,
  }) {
    this.getSdkModule = getSdkModule
    this.createSessionState = createSessionState
    this.envId = envId
    this.collection = collection
    this.ttlMs = ttlMs
    this.restoreSessionFromSnapshot = restoreSessionFromSnapshot
    this.createSessionSnapshot = createSessionSnapshot
    this.cachedApp = null
    this.cachedDb = null
  }

  async getDb() {
    if (this.cachedDb) {
      return this.cachedDb
    }

    if (!this.envId) {
      throw new Error("CLOUDBASE_ENV_ID is required for CloudBase session storage.")
    }

    const moduleNs = await this.getSdkModule()
    const cloudbase = moduleNs.default || moduleNs
    const app = cloudbase.init({ env: this.envId })
    this.cachedApp = app
    this.cachedDb = app.database()
    return this.cachedDb
  }

  async create(session) {
    const nextSession = session || this.createSessionState()
    const db = await this.getDb()
    const snapshot = this.createSessionSnapshot(nextSession)
    await db.collection(this.collection).doc(nextSession.id).set(snapshot)
    return nextSession
  }

  async get(sessionId) {
    const db = await this.getDb()
    const result = await db.collection(this.collection).doc(sessionId).get()
    const data = result?.data
    if (!data) {
      return null
    }

    return this.restoreSessionFromSnapshot(data)
  }

  async save(session) {
    const db = await this.getDb()
    const snapshot = this.createSessionSnapshot(session)
    await db.collection(this.collection).doc(session.id).set(snapshot)
    return session
  }

  async delete(sessionId) {
    const db = await this.getDb()
    await db.collection(this.collection).doc(sessionId).remove()
  }

  values() {
    return []
  }

  summary() {
    return {
      activeSessions: null,
      ttlMs: this.ttlMs,
      storageMode: "cloudbase",
      snapshotReady: true,
      implemented: true,
    }
  }
}
