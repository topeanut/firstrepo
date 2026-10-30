// Binary (bplist00) and XML property list parsers. UIDs come back as { uid: n }; data as Uint8Array.

export function parsePlist(bytes) {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  if (head === "bplist00") return parseBinary(bytes);
  return parseXml(new TextDecoder().decode(bytes));
}

function parseBinary(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const t = buf.length - 32;
  const offSize = buf[t + 6];
  const refSize = buf[t + 7];
  const numObjects = Number(dv.getBigUint64(t + 8));
  const top = Number(dv.getBigUint64(t + 16));
  const tableOff = Number(dv.getBigUint64(t + 24));

  const readUInt = (pos, size) => {
    let v = 0;
    for (let i = 0; i < size; i++) v = v * 256 + buf[pos + i];
    return v;
  };
  const offsets = new Array(numObjects);
  for (let i = 0; i < numObjects; i++) offsets[i] = readUInt(tableOff + i * offSize, offSize);

  const cache = new Map();
  const utf16 = new TextDecoder("utf-16be");
  const utf8 = new TextDecoder();

  function lengthAt(pos, info) {
    if (info !== 0xf) return [info, pos + 1];
    const marker = buf[pos + 1];
    const size = 1 << (marker & 0xf);
    return [readUInt(pos + 2, size), pos + 2 + size];
  }

  function obj(ref) {
    if (cache.has(ref)) return cache.get(ref);
    const pos = offsets[ref];
    const marker = buf[pos];
    const type = marker >> 4, info = marker & 0xf;
    let v;
    switch (type) {
      case 0x0:
        v = info === 0x8 ? false : info === 0x9 ? true : null;
        break;
      case 0x1: {
        const size = 1 << info;
        if (size === 8) v = Number(dv.getBigInt64(pos + 1));
        else if (size === 16) v = Number(dv.getBigInt64(pos + 9));
        else v = readUInt(pos + 1, size);
        break;
      }
      case 0x2:
        v = info === 2 ? dv.getFloat32(pos + 1) : dv.getFloat64(pos + 1);
        break;
      case 0x3:
        v = new Date((dv.getFloat64(pos + 1) + 978307200) * 1000);
        break;
      case 0x4: {
        const [len, start] = lengthAt(pos, info);
        v = buf.subarray(start, start + len);
        break;
      }
      case 0x5: {
        const [len, start] = lengthAt(pos, info);
        v = utf8.decode(buf.subarray(start, start + len));
        break;
      }
      case 0x6: {
        const [len, start] = lengthAt(pos, info);
        v = utf16.decode(buf.subarray(start, start + len * 2));
        break;
      }
      case 0x8:
        v = { uid: readUInt(pos + 1, info + 1) };
        break;
      case 0xa:
      case 0xc: {
        const [len, start] = lengthAt(pos, info);
        v = [];
        cache.set(ref, v);
        for (let i = 0; i < len; i++) v.push(obj(readUInt(start + i * refSize, refSize)));
        break;
      }
      case 0xd: {
        const [len, start] = lengthAt(pos, info);
        v = {};
        cache.set(ref, v);
        for (let i = 0; i < len; i++) {
          const k = obj(readUInt(start + i * refSize, refSize));
          v[k] = obj(readUInt(start + (len + i) * refSize, refSize));
        }
        break;
      }
      default:
        throw new Error("Unsupported bplist object type " + type);
    }
    cache.set(ref, v);
    return v;
  }
  return obj(top);
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const conv = (el) => {
    switch (el.tagName) {
      case "dict": {
        const o = {};
        const kids = [...el.children];
        for (let i = 0; i < kids.length; i += 2) o[kids[i].textContent] = conv(kids[i + 1]);
        return o;
      }
      case "array":
        return [...el.children].map(conv);
      case "string":
        return el.textContent;
      case "integer":
      case "real":
        return Number(el.textContent);
      case "true":
        return true;
      case "false":
        return false;
      case "date":
        return new Date(el.textContent);
      case "data":
        return Uint8Array.from(atob(el.textContent.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
      default:
        return null;
    }
  };
  return conv(doc.documentElement.firstElementChild);
}

// NSKeyedArchiver object graph helper.
export class KeyedArchive {
  constructor(plist) {
    this.objs = plist.$objects;
    this.top = plist.$top;
  }
  deref(v) {
    return v && typeof v === "object" && "uid" in v && Object.keys(v).length === 1 ? this.objs[v.uid] : v;
  }
  root() {
    return this.deref(Object.values(this.top)[0]);
  }
  get(o, key) {
    return o && key in o ? this.deref(o[key]) : undefined;
  }
  // Converts NSArray / NSDictionary / NSString wrappers to plain JS values.
  plain(v, depth = 0) {
    v = this.deref(v);
    if (depth > 20 || !v || typeof v !== "object" || v instanceof Uint8Array || v instanceof Date) return v;
    if (Array.isArray(v)) return v.map((x) => this.plain(x, depth + 1));
    if ("NS.keys" in v) {
      const o = {};
      v["NS.keys"].forEach((k, i) => (o[this.plain(k, depth + 1)] = this.plain(v["NS.objects"][i], depth + 1)));
      return o;
    }
    if ("NS.objects" in v) return v["NS.objects"].map((x) => this.plain(x, depth + 1));
    if ("NS.string" in v) return v["NS.string"];
    if ("NS.time" in v) return v["NS.time"];
    return v;
  }
}
