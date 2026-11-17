// WebSocket with auto reconnect.
export function connect({ hello, onMessage, onStatus }) {
  let ws;
  let open = false;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  function go() {
    ws = new WebSocket(url);
    ws.onopen = () => {
      open = true;
      onStatus?.(true);
      const h = typeof hello === "function" ? hello() : hello;
      if (h) ws.send(JSON.stringify(h));
    };
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch (err) {
        console.error(err);
      }
    };
    ws.onclose = () => {
      open = false;
      onStatus?.(false);
      setTimeout(go, 1500);
    };
  }
  go();
  return {
    send(msg) {
      if (open && ws.readyState === 1) ws.send(JSON.stringify(msg));
    },
  };
}
