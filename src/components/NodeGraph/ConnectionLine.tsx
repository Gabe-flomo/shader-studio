const TYPE_COLORS: Record<string, string> = {
  float: '#f0a0c0',
  vec2:  '#00aaff',
  vec3:  '#00ffaa',
  vec4:  '#ffaa00',
};

interface Props {
  from: { x: number; y: number };
  to: { x: number; y: number };
  dataType?: string;
}

export function ConnectionLine({ from, to, dataType }: Props) {
  const midX = (from.x + to.x) / 2;
  const path = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
  const color = (dataType && TYPE_COLORS[dataType]) ? TYPE_COLORS[dataType] : '#666';

  return (
    <path
      d={path}
      stroke={color}
      strokeWidth={2.5}
      fill="none"
      strokeOpacity={0.8}
    />
  );
}
