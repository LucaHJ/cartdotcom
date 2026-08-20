export function orderedCarouselSlides(slides) {
  return [...(slides || [])]
    .map((slide, index) => ({
      index: Number.isFinite(Number(slide.index)) ? Number(slide.index) : index,
      mediaType: slide.mediaType || slide.media_type || "image",
      url: slide.url || slide.source_url || "",
      width: Number(slide.width || 0),
      height: Number(slide.height || 0),
      checksum: slide.checksum || null,
    }))
    .sort((a, b) => a.index - b.index);
}

export function carouselManifest({ shortcode, parentUrl, slides }) {
  const ordered = orderedCarouselSlides(slides);
  return {
    media_type: "carousel",
    shortcode,
    parent_url: parentUrl,
    slide_count: ordered.length,
    slides: ordered.map((slide, position) => ({ ...slide, position: position + 1 })),
  };
}

export function validateCarouselManifest(manifest) {
  if (!manifest || manifest.media_type !== "carousel") return false;
  if (!Array.isArray(manifest.slides) || manifest.slides.length === 0) return false;
  return manifest.slides.every((slide, index) => slide.position === index + 1 && Boolean(slide.url || slide.checksum));
}
