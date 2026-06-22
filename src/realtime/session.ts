export type Role = 'host' | 'player' | 'board';
export interface Session { clientToken: string; socketId: string | null; playerId: string; role: Role; gameId?: string; }

export class SessionRegistry {
  private byTokenMap = new Map<string, Session>();
  private bySocketMap = new Map<string, Session>();

  bind(clientToken: string, socketId: string, playerId: string, role: Role, gameId?: string): void {
    const existing = this.byTokenMap.get(clientToken);
    if (existing?.socketId) this.bySocketMap.delete(existing.socketId);
    const session: Session = { clientToken, socketId, playerId, role, ...(gameId !== undefined ? { gameId } : existing?.gameId !== undefined ? { gameId: existing.gameId } : {}) };
    this.byTokenMap.set(clientToken, session);
    this.bySocketMap.set(socketId, session);
  }
  bySocket(socketId: string): Session | undefined { return this.bySocketMap.get(socketId); }
  byToken(token: string): Session | undefined { return this.byTokenMap.get(token); }
  markDisconnected(socketId: string): Session | undefined {
    const s = this.bySocketMap.get(socketId);
    if (!s) return undefined;
    this.bySocketMap.delete(socketId);
    s.socketId = null;
    return s;
  }
}
