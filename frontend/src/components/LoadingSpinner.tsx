interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses: Record<string, string> = {
  sm: 'h-5 w-5 border-2',
  md: 'h-8 w-8 border-2',
  lg: 'h-12 w-12 border-3',
};

export default function LoadingSpinner({ size = 'md' }: LoadingSpinnerProps) {
  return (
    <div className="flex items-center justify-center py-12">
      <div
        className={`animate-spin rounded-full border-primary-600 border-t-transparent ${sizeClasses[size]}`}
      />
    </div>
  );
}
