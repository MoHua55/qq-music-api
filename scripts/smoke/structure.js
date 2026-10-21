// 冒烟只记回包的结构，不记任何值：类型、对象的键、数组空不空和第一项的结构。
// 键全是数字（按 id 索引的映射）或太多的对象只记成 map，免得每次跑出不同的键。
// 有些回包拿请求里的编号当键（例如按 songmid 索引的播放链接）：等于 aliases 里某个值的键
// 换成 <名字>，快照里不会出现真实编号。

const MAX_DEPTH = 5;
const MAX_KEYS = 60;

const shapeOf = (value, depth = 0, aliases = {}) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (!value.length) return { type: 'array', empty: true };
    return depth >= MAX_DEPTH
      ? { type: 'array', empty: false }
      : { type: 'array', empty: false, item: shapeOf(value[0], depth + 1, aliases) };
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    if (keys.length > MAX_KEYS || (keys.length && keys.every((key) => /^\d+$/.test(key))))
      return { type: 'map' };
    if (depth >= MAX_DEPTH) return { type: 'object' };
    return {
      type: 'object',
      keys: Object.fromEntries(
        keys.map((key) => [
          Object.hasOwn(aliases, key) ? `<${aliases[key]}>` : key,
          shapeOf(value[key], depth + 1, aliases),
        ]),
      ),
    };
  }
  return typeof value;
};

const typeName = (shape) => (typeof shape === 'string' ? shape : shape.type);

/**
 * 逐层比较两份结构。changes 是会让调用方出错的变化（少了键、类型变了、原来有内容的数组变空）；
 * additions 是新出现的键，或原来是空数组现在有内容，一般不影响调用方，只列出来。
 */
const diffShapes = (expected, actual, at = 'body') => {
  const changes = [];
  const additions = [];
  const walk = (a, b, where) => {
    if (typeName(a) !== typeName(b)) {
      changes.push(`${where}：${typeName(a)} → ${typeName(b)}`);
      return;
    }
    if (typeName(a) === 'array') {
      if (!a.empty && b.empty) changes.push(`${where}：原来有内容，现在是空数组`);
      else if (a.empty && !b.empty) additions.push(`${where}：原来是空数组，现在有内容`);
      else if (a.item && b.item) walk(a.item, b.item, `${where}[]`);
      return;
    }
    if (typeName(a) === 'object' && a.keys && b.keys) {
      for (const key of Object.keys(a.keys)) {
        if (!(key in b.keys)) changes.push(`${where}.${key}：不见了`);
        else walk(a.keys[key], b.keys[key], `${where}.${key}`);
      }
      for (const key of Object.keys(b.keys))
        if (!(key in a.keys)) additions.push(`${where}.${key}：新出现`);
    }
  };
  walk(expected, actual, at);
  return { changes, additions };
};

module.exports = { shapeOf, diffShapes };
