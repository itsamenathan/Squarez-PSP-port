// Two-player link for versus games, over WebRTC using PeerJS (src/vendor/peerjs.min.js, v1.5.5).
// The public PeerJS server (0.peerjs.com) only introduces the two browsers; game messages then
// go directly between them, or through PeerJS's TURN relay when a network blocks that.

const ID_PREFIX = 'squarez-v1-';
const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, which look like 1 and 0
const CONNECT_MS = 20000;
const PING_MS = 1000;
const LOST_MS = 8000;

let loading = null;

// The library is only fetched the first time someone opens multiplayer.
function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('./vendor/peerjs.min.js', import.meta.url).href;
      s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS failed to load')));
      s.onerror = () => { loading = null; reject(new Error('PeerJS failed to load')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export function cleanRoomCode(text) {
  return String(text).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

function newRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += ROOM_LETTERS[Math.floor(Math.random() * ROOM_LETTERS.length)];
  return code;
}

// Messages from PeerJS errors that a player can act on.
function errorText(err) {
  switch (err && err.type) {
    case 'peer-unavailable': return 'No game is waiting with that code';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'Unable to reach the matchmaking server';
    case 'browser-incompatible': return 'This browser does not support multiplayer';
    case 'webrtc': return 'Unable to connect to the other player';
    default: return (err && err.message) || 'Connection failed';
  }
}

// Events: onMessage(msg), onPeer(joined), onClose(reason) where reason is 'left' or 'lost'.
export class Link {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.code = null;
    this.closed = false;
    this.lastHeard = 0;
    this.timer = null;
    this.onMessage = () => {};
    this.onPeer = () => {};
    this.onClose = () => {};
  }

  get connected() { return !!(this.conn && this.conn.open); }

  // Register a room code and wait for a guest. Resolves with the code once registered.
  async host() {
    const Peer = await loadPeerJS();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newRoomCode();
      try {
        await this.open(Peer, ID_PREFIX + code);
        this.code = code;
        this.peer.on('connection', conn => this.accept(conn));
        // Keep the room code registered while waiting, in case the server link drops.
        this.peer.on('disconnected', () => {
          if (!this.closed && !this.conn && this.peer && !this.peer.destroyed) this.peer.reconnect();
        });
        return code;
      } catch (err) {
        this.destroyPeer();
        if (err.type !== 'unavailable-id') throw new Error(errorText(err));
      }
    }
    throw new Error('Unable to get a room code. Try again');
  }

  async join(code) {
    const Peer = await loadPeerJS();
    try {
      await this.open(Peer);
    } catch (err) {
      this.destroyPeer();
      throw new Error(errorText(err));
    }
    this.code = code;
    const conn = this.peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
    await new Promise((resolve, reject) => {
      const fail = err => { cleanup(); reject(new Error(errorText(err))); };
      const timeout = setTimeout(() => fail({ message: 'Timed out connecting to the other player' }), CONNECT_MS);
      const cleanup = () => { clearTimeout(timeout); this.peer && this.peer.off('error', fail); };
      this.peer.on('error', fail);
      conn.on('open', () => { cleanup(); resolve(); });
    });
    this.attach(conn);
  }

  open(Peer, id) {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
      this.peer = peer;
      const timeout = setTimeout(() => reject({ type: 'network' }), CONNECT_MS);
      peer.once('open', () => { clearTimeout(timeout); peer.off('error', fail); resolve(); });
      const fail = err => { clearTimeout(timeout); reject(err); };
      peer.once('error', fail);
      // After setup, a lost link to the matchmaking server doesn't affect a game in progress.
      peer.on('error', () => {});
    });
  }

  accept(conn) {
    if (this.conn || this.closed) {
      conn.on('open', () => conn.close());
      return;
    }
    conn.on('open', () => {
      this.attach(conn);
      this.onPeer(true);
    });
  }

  attach(conn) {
    this.conn = conn;
    this.lastHeard = Date.now();
    conn.on('data', msg => {
      this.lastHeard = Date.now();
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'ping') return;
      if (msg.t === 'bye') { this.dropConn('left'); return; }
      this.onMessage(msg);
    });
    conn.on('close', () => { if (this.conn === conn) this.dropConn('lost'); });
    conn.on('error', () => { if (this.conn === conn) this.dropConn('lost'); });
    // A data channel can take a long time to notice a vanished peer, so ping every second.
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.conn) return;
      this.send({ t: 'ping' });
      if (Date.now() - this.lastHeard > LOST_MS) this.dropConn('lost');
    }, PING_MS);
  }

  dropConn(reason) {
    const conn = this.conn;
    if (!conn) return;
    this.conn = null;
    clearInterval(this.timer);
    try { conn.close(); } catch { /* already closed */ }
    if (!this.closed) this.onClose(reason);
  }

  send(msg) {
    if (!this.connected) return;
    try { this.conn.send(msg); } catch { /* the close handler reports it */ }
  }

  destroyPeer() {
    if (this.peer) {
      try { this.peer.destroy(); } catch { /* ignore */ }
      this.peer = null;
    }
  }

  close() {
    if (this.closed) return;
    this.send({ t: 'bye' });
    this.closed = true;
    clearInterval(this.timer);
    const conn = this.conn;
    this.conn = null;
    // Give the goodbye a moment to leave before tearing the connection down.
    setTimeout(() => {
      try { conn && conn.close(); } catch { /* ignore */ }
      this.destroyPeer();
    }, 200);
  }
}
