/** Fetches JSON without caching: live files change between reads. */
export async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

/** Reads a JSON file the user dropped or picked. */
export async function readJsonFile<T>(file: File): Promise<T> {
  return JSON.parse(await file.text()) as T;
}
