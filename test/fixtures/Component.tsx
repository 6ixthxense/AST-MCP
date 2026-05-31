interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function Button({ label, onClick, disabled }: ButtonProps) {
  return <button onClick={onClick} disabled={disabled}>{label}</button>;
}

type CardProps = { title: string; subtitle?: string };

export const Card: React.FC<CardProps> = ({ title, subtitle }) => {
  return <div>{title}{subtitle}</div>;
};

export function Inline({ a, b }: { a: string; b?: number }) {
  return <span>{a}</span>;
}

export function Plain(x: number) {
  return x * 2;
}
