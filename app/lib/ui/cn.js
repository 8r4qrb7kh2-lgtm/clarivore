export function cn(...parts) {
  return parts
    .flatMap((part) => {
      if (Array.isArray(part)) return part;
      return [part];
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}
