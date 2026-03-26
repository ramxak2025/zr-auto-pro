export default function LoadingSpinner() {
  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header skeleton */}
      <div className="flex-shrink-0 h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 pt-[env(safe-area-inset-top,0px)]" style={{ minHeight: 'calc(3.5rem + env(safe-area-inset-top, 0px))' }}>
        <div className="h-8 w-20 bg-gray-100 rounded animate-pulse" />
        <div className="flex-1" />
        <div className="h-7 w-7 bg-gray-100 rounded-full animate-pulse" />
      </div>

      {/* Content skeleton */}
      <div className="flex-1 p-4 space-y-4 overflow-hidden">
        <div className="h-6 w-40 bg-gray-200 rounded animate-pulse" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-24 bg-white rounded-xl border border-gray-100 animate-pulse" />
          <div className="h-24 bg-white rounded-xl border border-gray-100 animate-pulse" />
        </div>
        <div className="h-40 bg-white rounded-xl border border-gray-100 animate-pulse" />
        <div className="h-32 bg-white rounded-xl border border-gray-100 animate-pulse" />
      </div>

      {/* Tab bar skeleton */}
      <div className="flex-shrink-0 h-[68px] bg-white border-t border-gray-100 flex items-center justify-around px-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="h-5 w-5 bg-gray-100 rounded animate-pulse" />
            <div className="h-2 w-8 bg-gray-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
