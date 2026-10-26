// 島どうしで値を渡すための小さな入れ物。
// 出発日時は React の状態なので DOM からは読めない。出発日時の島が書き込み、
// 控の島が読む。島が増えてもここに足すだけで済むように、キーごとに持つ。
const store = new Map();
const listeners = new Set();

export function publish(key, value) {
  store.set(key, value);
  for (const listener of listeners) listener(key, value);
}

export function read(key) {
  return store.get(key);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
