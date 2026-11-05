import { ArrowtriangleDown2FillIcon } from './sfSymbols';

export const CompositeTripIcon = ({ color, size = 18 }: { color: string; size?: number }) => (
  <ArrowtriangleDown2FillIcon size={size} color={color} rotate={-90} style={{ flexShrink: 0 }} />);
