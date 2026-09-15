import { parse } from "acorn";
import { expandRelay, extractMedia } from "./extract";
import { MAX_JSON, type MediaRecord } from "./types";
import { object } from "./security";

// Decode only data expressions. Neither calls nor arbitrary member access are evaluated.
export class SsrDecoder {
  private refs = new Map<number, unknown>();
  decode(source: string): MediaRecord[] {
    if (
      source.length > MAX_JSON ||
      !/relayRecords|__INITIAL_STATE__/.test(source)
    )
      return [];
    let ast: any;
    try {
      ast = parse(source, { ecmaVersion: "latest", sourceType: "script" });
    } catch {
      return [];
    }
    const result: MediaRecord[] = [],
      stack = [ast];
    let steps = 180000;
    const read = (node: any, depth = 0): any => {
      if (!node || depth > 65 || --steps < 0) return undefined;
      switch (node.type) {
        case "Literal":
          return typeof node.value === "string" ||
            typeof node.value === "boolean" ||
            typeof node.value === "number" ||
            node.value === null
            ? node.value
            : undefined;
        case "Identifier":
          return undefined;
        case "UnaryExpression": {
          const v = read(node.argument, depth + 1);
          return node.operator === "!" &&
            (typeof v === "boolean" || typeof v === "number")
            ? !v
            : node.operator === "-" && typeof v === "number"
              ? -v
              : undefined;
        }
        case "ArrayExpression":
          return node.elements
            .slice(0, 10000)
            .map((n: any) => read(n, depth + 1));
        case "ObjectExpression": {
          const out: Record<string, unknown> = Object.create(null);
          for (const p of node.properties.slice(0, 40000)) {
            if (
              p.type !== "Property" ||
              p.computed ||
              p.kind !== "init" ||
              p.method
            )
              continue;
            const key = p.key.name ?? p.key.value;
            if (
              typeof key === "string" &&
              !["__proto__", "constructor", "prototype"].includes(key)
            )
              out[key] = read(p.value, depth + 1);
          }
          return out;
        }
        case "AssignmentExpression": {
          const index = refIndex(node.left);
          if (node.operator !== "=" || index === undefined) return;
          const v = read(node.right, depth + 1);
          if (this.refs.size < 50000) this.refs.set(index, v);
          return v;
        }
        case "MemberExpression": {
          const index = refIndex(node);
          return index === undefined ? undefined : this.refs.get(index);
        }
        default:
          return undefined;
      }
    };
    while (stack.length && --steps > 0) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (
        node.type === "Property" &&
        !node.computed &&
        (node.key.name ?? node.key.value) === "relayRecords"
      ) {
        const records = object(read(node.value));
        if (records) result.push(...extractMedia(expandRelay(records), "ssr"));
        continue;
      }
      if (
        node.type === "AssignmentExpression" &&
        node.left?.type === "MemberExpression" &&
        ["window", "self", "globalThis"].includes(node.left.object?.name) &&
        (node.left.property?.name ?? node.left.property?.value) ===
          "__INITIAL_STATE__"
      ) {
        result.push(...extractMedia(read(node.right), "initial"));
        continue;
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (let i = value.length - 1; i >= 0; i--)
            if (value[i]?.type) stack.push(value[i]);
        } else if (value && typeof value === "object" && "type" in value)
          stack.push(value);
      }
    }
    return result;
  }
}
function refIndex(node: any): number | undefined {
  return node?.type === "MemberExpression" &&
    node.computed &&
    node.object?.type === "Identifier" &&
    node.object.name === "$R" &&
    node.property?.type === "Literal" &&
    Number.isInteger(node.property.value) &&
    node.property.value >= 0 &&
    node.property.value < 100000
    ? node.property.value
    : undefined;
}
