import { createHash } from "node:crypto";
import { isIPv6 } from "node:net";

type Headers = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim() || undefined;

/** 접속자의 IP. Cloudflare 터널이 붙이는 CF-Connecting-IP 를 우선하고, 없으면 X-Forwarded-For, 그것도 없으면 소켓 주소. (서버는 127.0.0.1 에만 열려 있어 헤더를 직접 보낼 수 있는 쪽은 터널뿐이다.) */
export function clientIp(h: Headers, remote: string | undefined): { ip: string; viaProxy: boolean } {
  const fwd = first(h["cf-connecting-ip"]) ?? first(h["x-forwarded-for"]);
  return { ip: fwd ?? remote ?? "unknown", viaProxy: !!fwd };
}

/** 같은 사람의 주소가 조금씩 바뀌는 경우를 묶는다: IPv4-mapped 는 IPv4 로, IPv6 는 앞 64비트(/64)로 줄인다. */
export function ipKey(ip: string): string {
  const v = ip.replace(/^::ffff:/i, "");
  if (!isIPv6(v)) return v;
  const [head = "", tail = ""] = v.split("::");
  const a = head ? head.split(":") : [], b = tail ? tail.split(":") : [];
  const groups = v.includes("::") ? [...a, ...Array(Math.max(8 - a.length - b.length, 0)).fill("0"), ...b] : a;
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

const isLoopback = (ip: string) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

/** 사용자 아이디. 이 컴퓨터에서 직접 연 접속과 OWNER_IPS 에 적은 IP 는 기존 기록("me")을, 나머지는 IP 해시로 만든 별도 계정을 쓴다. 원본 IP 는 저장하지 않는다. */
export function userIdFor(h: Headers, remote: string | undefined, owners: ReadonlySet<string>): { userId: string; ip: string; local: boolean } {
  const { ip, viaProxy } = clientIp(h, remote);
  if (!viaProxy && isLoopback(ip)) return { userId: "me", ip, local: true };
  const key = ipKey(ip);
  if (owners.has(key)) return { userId: "me", ip, local: false };
  return { userId: "ip-" + createHash("sha256").update("epa:" + key).digest("hex").slice(0, 12), ip, local: false };
}

export const parseOwners = (s: string | undefined): Set<string> => new Set((s ?? "").split(",").map((x) => x.trim()).filter(Boolean).map(ipKey));
