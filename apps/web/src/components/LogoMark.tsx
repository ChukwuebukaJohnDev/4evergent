import logoMark from '../assets/logo-mark.svg';

interface LogoMarkProps {
  className?: string;
  size?: number;
}

/**
 * 4evergent brand mark — abstract geometric "4" built from four rounded
 * vertical bars with a horizontal crossbar, cyan → electric-blue gradient.
 * Reusable across landing, login, and dashboard surfaces.
 */
export default function LogoMark({ className = '', size = 24 }: LogoMarkProps) {
  return (
    <img
      src={logoMark}
      alt=""
      aria-hidden="true"
      width={size}
      height={Math.round(size * 28 / 24)}
      className={`logo-mark-img ${className}`}
    />
  );
}
