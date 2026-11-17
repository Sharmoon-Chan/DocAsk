interface ExoBrainLogoProps {
  className?: string;
}

export default function ExoBrainLogo({ className = "h-9 w-9" }: ExoBrainLogoProps) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}exobrain.svg?v=2`}
      alt="问档 DocAsk"
      width={64}
      height={64}
      className={`shrink-0 ${className}`}
    />
  );
}
