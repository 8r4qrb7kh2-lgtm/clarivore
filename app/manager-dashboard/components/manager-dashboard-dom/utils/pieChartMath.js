// Geometry helpers convert category proportions into SVG arc paths.

export function polarToCartesian(cx, cy, radius, angleInDegrees) {
  // Convert angle + radius into x/y point for the arc perimeter.
  const radians = (angleInDegrees * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

export function describePieSegment(cx, cy, radius, startAngle, endAngle) {
  // Build a closed wedge path from center -> arc start -> arc end -> center.
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}
