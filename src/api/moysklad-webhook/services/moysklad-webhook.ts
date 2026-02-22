type MoySkladMeta = { href: string; type: string; mediaType?: string };

function getMoySkladHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json;charset=utf-8",
  } as const;
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: getMoySkladHeaders(token) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MoySklad API error ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

export default () => ({
  async fetchByHref(href: string) {
    const token = process.env.MOYSKLAD_ACCESS_TOKEN;
    if (!token) throw new Error("MOYSKLAD_ACCESS_TOKEN is not set");

    // MoySklad может отдавать meta.href с expand/параметрами — нам не мешает
    return fetchJson<{ meta?: MoySkladMeta } & Record<string, unknown>>(href, token);
  },
});
