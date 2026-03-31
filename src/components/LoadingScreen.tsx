/**
 * Full-screen loading spinner (initial auth check).
 */
export function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center z-50 gap-4 animate-fade-in" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
      <div className="w-10 h-10 border-[3px] border-surface-200 dark:border-dark-400 border-t-navy-900 dark:border-t-accent-blue rounded-full animate-spin" />
    </div>
  );
}

/**
 * Skeleton rows for tables — shows while Firestore data is loading.
 * Use this inside any page that reads from the store.
 */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden animate-pulse">
      {/* Header */}
      <div className="flex gap-4 px-5 py-3 bg-surface-50 border-b border-surface-200">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 bg-surface-200 rounded flex-1" />
        ))}
      </div>
      {/* Rows */}
      <div className="divide-y divide-surface-100">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="flex items-center gap-4 px-5 py-4">
            {/* Avatar placeholder (first col) */}
            {rowIdx < rows && (
              <div className="w-10 h-10 bg-surface-200 rounded-lg flex-shrink-0" />
            )}
            {/* Text placeholders */}
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-surface-200 rounded w-3/4" />
              <div className="h-2 bg-surface-100 rounded w-1/2" />
            </div>
            {/* Right side placeholders */}
            <div className="h-3 bg-surface-200 rounded w-16" />
            <div className="h-6 bg-surface-100 rounded-full w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Simple card skeleton for stats/summary cards.
 */
export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-${count} gap-3 animate-pulse`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card px-4 py-3 space-y-2">
          <div className="h-2 bg-surface-200 rounded w-20" />
          <div className="h-6 bg-surface-200 rounded w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * Page-level loading wrapper. Shows skeleton if collection is loading.
 */
export function PageLoading({ message = 'Cargando datos...' }: { message?: string }) {
  return (
    <div className="space-y-5 animate-fade-up">
      <div className="card p-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 border-[3px] border-surface-200 border-t-navy-900 rounded-full animate-spin" />
          <div>
            <p className="font-display font-semibold text-navy-700 text-sm">{message}</p>
            <p className="text-navy-400 text-xs mt-0.5">Los datos se cargan desde la caché local y se sincronizan con el servidor.</p>
          </div>
        </div>
      </div>
      <CardSkeleton />
      <TableSkeleton />
    </div>
  );
}
