const ARTIFACT_TYPES = new Set(["book", "quote", "film", "tv_show", "recipe", "font", "music", "podcast", "youtube"]);

const COLLECTIONS = Object.freeze({
  book: "books",
  quote: "quotes",
  film: "films",
  tv_show: "tv-shows",
  recipe: "recipes",
  font: "fonts",
  music: "music",
  podcast: "podcasts",
  youtube: "youtube",
});

export function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "untitled";
}

export function normalizeArtifactType(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (raw === "tv" || raw === "television" || raw === "tv_show") return "tv_show";
  if (raw === "song" || raw === "album" || raw === "audio") return "music";
  return ARTIFACT_TYPES.has(raw) ? raw : null;
}

export function canonicalArtifactKey({ artifactType, name, canonicalUrl }) {
  const type = normalizeArtifactType(artifactType);
  if (!type) return null;
  if (canonicalUrl) return `${type}:url:${String(canonicalUrl).trim().toLowerCase()}`;
  return `${type}:${slugify(name)}`;
}

export function artifactLibraryPath({ artifactType, name }) {
  const type = normalizeArtifactType(artifactType);
  if (!type) return null;
  return `${COLLECTIONS[type]}/${slugify(name)}.html`;
}

export function mergeArtifactSources(existingSources, source) {
  const map = new Map();
  for (const item of [...(existingSources || []), source].filter(Boolean)) {
    map.set(item.job_id || item.jobId || item.source_url || JSON.stringify(item), item);
  }
  return [...map.values()];
}
