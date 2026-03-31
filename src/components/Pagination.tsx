import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

export function Pagination({
  currentPage, totalPages, totalItems, pageSize,
  onPageChange, onPageSizeChange, pageSizeOptions = [15, 25, 50, 100],
}: PaginationProps) {
  if (totalItems === 0) return null;

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-surface-200 dark:border-dark-border bg-surface-50/50 dark:bg-dark-100/50">
      {/* Info + page size */}
      <div className="flex items-center gap-3 text-sm text-navy-500">
        <span className="font-display">
          <span className="font-semibold text-navy-700">{start}–{end}</span> de{' '}
          <span className="font-semibold text-navy-700">{totalItems}</span>
        </span>
        {onPageSizeChange && (
          <>
            <span className="text-navy-200">|</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-navy-400">Mostrar</span>
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="bg-white dark:bg-dark-200 border border-surface-200 dark:border-dark-border rounded-md px-2 py-1 text-xs font-display font-medium text-navy-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-navy-300"
              >
                {pageSizeOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="p-1.5 rounded-md text-navy-400 hover:bg-surface-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          title="Primera página"
        >
          <ChevronsLeft size={16} />
        </button>
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="p-1.5 rounded-md text-navy-400 hover:bg-surface-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          title="Anterior"
        >
          <ChevronLeft size={16} />
        </button>

        {/* Page numbers */}
        <div className="flex items-center gap-0.5 mx-1">
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let page: number;
            if (totalPages <= 5) {
              page = i + 1;
            } else if (currentPage <= 3) {
              page = i + 1;
            } else if (currentPage >= totalPages - 2) {
              page = totalPages - 4 + i;
            } else {
              page = currentPage - 2 + i;
            }

            return (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                className={`w-8 h-8 rounded-md text-xs font-display font-semibold transition-all duration-150
                  ${currentPage === page
                    ? 'bg-navy-900 dark:bg-blue-600 text-white shadow-sm'
                    : 'text-navy-500 dark:text-gray-400 hover:bg-surface-200 dark:hover:bg-dark-300'
                  }`}
              >
                {page}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="p-1.5 rounded-md text-navy-400 hover:bg-surface-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          title="Siguiente"
        >
          <ChevronRight size={16} />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="p-1.5 rounded-md text-navy-400 hover:bg-surface-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          title="Última página"
        >
          <ChevronsRight size={16} />
        </button>
      </div>
    </div>
  );
}
