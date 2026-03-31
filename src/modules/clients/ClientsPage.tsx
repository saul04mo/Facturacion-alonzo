import { useState, useMemo, useEffect } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import { saveClient, deleteClient, checkDuplicate, getRecentClients, searchClientsQuery } from './clientService';
import {
  Users, Plus, Search, Edit, Trash2, User, Phone, Mail, MapPin, CreditCard,
  ArrowUpDown,
} from 'lucide-react';

// ============================
// CLIENT FORM MODAL
// ============================
export function ClientFormModal({ open, onClose, client }: { open: boolean; onClose: () => void; client: any | null }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: client?.name || client?.nombre || '',
    rif_ci: client?.rif_ci || client?.cedula || '',
    phone: client?.phone || '',
    email: client?.email || '',
    address: client?.address || client?.direccion || '',
  });
  const [saving, setSaving] = useState(false);

  function handleChange(field: string, value: string) {
    if (field === 'rif_ci' || field === 'phone') value = value.replace(/[^0-9]/g, '');
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.warning('El nombre es obligatorio.');
    setSaving(true);
    try {
      if (form.rif_ci || form.phone) {
        const dupMessage = await checkDuplicate({ rif_ci: form.rif_ci || null, phone: form.phone || null }, client?.id);
        if (dupMessage) { toast.warning(dupMessage); setSaving(false); return; }
      }
      await saveClient(client?.id || null, {
        name: form.name, rif_ci: form.rif_ci || null,
        phone: form.phone || null, email: form.email || null,
        address: form.address || null,
      });
      onClose();
    } catch (err) { console.error(err); toast.error('Error al guardar cliente.'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={client ? 'Editar Cliente' : 'Nuevo Cliente'}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Nombre completo</label>
          <div className="relative">
            <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300" />
            <input value={form.name} onChange={(e) => handleChange('name', e.target.value)} className="input-field pl-10" placeholder="Nombre del cliente" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Cédula/RIF</label>
            <div className="relative">
              <CreditCard size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300" />
              <input value={form.rif_ci} onChange={(e) => handleChange('rif_ci', e.target.value)} className="input-field pl-10" inputMode="numeric" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Teléfono</label>
            <div className="relative">
              <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300" />
              <input value={form.phone} onChange={(e) => handleChange('phone', e.target.value)} className="input-field pl-10" inputMode="numeric" />
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Correo</label>
          <div className="relative">
            <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300" />
            <input value={form.email} onChange={(e) => handleChange('email', e.target.value)} className="input-field pl-10" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Dirección</label>
          <div className="relative">
            <MapPin size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300" />
            <input value={form.address} onChange={(e) => handleChange('address', e.target.value)} className="input-field pl-10" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">{saving ? 'Guardando...' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ============================
// MAIN CLIENTS PAGE
// ============================
export function ClientsPage() {
  const { can } = usePermissions();
  const toast = useToast();

  const [localClients, setLocalClients] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'cedula'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [formOpen, setFormOpen] = useState(false);
  const [editClient, setEditClient] = useState<any | null>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Initial Load
  useEffect(() => {
    let mounted = true;
    getRecentClients().then(data => {
      if (mounted) {
        setLocalClients(data);
        setIsLoading(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  // Filter + sort
  const sortedClients = useMemo(() => {
    return [...localClients].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = (a.name || a.nombre || '').localeCompare(b.name || b.nombre || '');
      else cmp = (a.rif_ci || a.cedula || '').localeCompare(b.rif_ci || b.cedula || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [localClients, sortKey, sortDir]);

  // Paginated
  const totalPages = Math.max(1, Math.ceil(sortedClients.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedClients.slice(start, start + pageSize);
  }, [sortedClients, currentPage, pageSize]);

  async function handleSearchExecute(val: string) {
    setIsLoading(true);
    const results = await searchClientsQuery(val);
    setLocalClients(results);
    setIsLoading(false);
    setPage(1);
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setSearch(val);
  }
  
  function handleSearchSubmit(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleSearchExecute(search);
    }
  }

  // Removed duplicate handleSearch. handleSearch takes ChangeEvent now.
  function handleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  }
  function handlePageSizeChange(size: number) { setPageSize(size); setPage(1); }

  function handleEdit(c: any) { setEditClient(c); setFormOpen(true); }
  function handleAdd() { setEditClient(null); setFormOpen(true); }
  async function handleDelete(c: any) {
    if (!confirm(`¿Eliminar "${c.name || c.nombre}"?`)) return;
    try { await deleteClient(c.id); } catch { toast.error('Error al eliminar cliente.'); }
  }

  function SortHeader({ label, field }: { label: string; field: typeof sortKey }) {
    const active = sortKey === field;
    return (
      <button onClick={() => handleSort(field)}
        className={`flex items-center gap-1 text-[10px] font-display font-semibold uppercase tracking-wider transition-colors
          ${active ? 'text-navy-900' : 'text-navy-400 hover:text-navy-600'}`}>
        {label} <ArrowUpDown size={10} className={active ? 'text-navy-700' : 'text-navy-300'} />
      </button>
    );
  }

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Header */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-12 bg-cyan-500 rounded-full" />
            <div>
              <h1 className="text-xl font-display font-bold text-navy-900">Clientes</h1>
              <p className="text-navy-400 text-sm">Mostrando {localClients.length} resultados</p>
            </div>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial sm:w-64">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
              <input value={search} onChange={handleSearch} onKeyDown={handleSearchSubmit}
                className="input-field pl-9 text-sm" placeholder="Buscar cédula o prefijo del nombre y oprime Enter..." />
              <button 
                onClick={() => handleSearchExecute(search)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-700 bg-surface-100 rounded px-2 py-0.5 text-xs font-display font-semibold transition-colors"
              >
                Buscar
              </button>
            </div>
            {can('canCreateClients') && (
              <button onClick={handleAdd} className="btn-primary text-sm whitespace-nowrap"><Plus size={16} /> Nuevo</button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-16 text-center">
            <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-navy-400 text-sm font-display">Buscando clientes...</p>
          </div>
        ) : paginated.length === 0 ? (
          <div className="p-16 text-center">
            <Users size={48} className="mx-auto text-navy-200 mb-3" />
            <p className="text-navy-400 text-sm font-display">No hay clientes que coincidan.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-200 bg-surface-50">
                    <th className="text-left px-5 py-3"><SortHeader label="Nombre" field="name" /></th>
                    <th className="text-left px-5 py-3"><SortHeader label="Cédula / RIF" field="cedula" /></th>
                    <th className="text-left px-5 py-3">
                      <span className="text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider">Teléfono</span>
                    </th>
                    <th className="text-left px-5 py-3">
                      <span className="text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider">Correo</span>
                    </th>
                    <th className="text-right px-5 py-3 w-28">
                      <span className="text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {paginated.map((client: any) => {
                    const name = client.name || client.nombre || '—';
                    const cedula = client.rif_ci || client.cedula || '';
                    const initial = name.charAt(0).toUpperCase();

                    return (
                      <tr key={client.id} className="hover:bg-surface-50 transition-colors group">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-cyan-50 flex items-center justify-center flex-shrink-0 border border-cyan-100">
                              <span className="text-xs font-display font-bold text-cyan-700">{initial}</span>
                            </div>
                            <div>
                              <p className="font-display font-semibold text-navy-900 text-sm">{name}</p>
                              {client.address && (
                                <p className="text-[10px] text-navy-400 flex items-center gap-1 mt-0.5">
                                  <MapPin size={9} /> {client.address.length > 40 ? client.address.slice(0, 40) + '...' : client.address}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          {cedula ? (
                            <span className="font-mono text-sm text-navy-700">{cedula}</span>
                          ) : (
                            <span className="text-xs text-navy-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {client.phone ? (
                            <span className="text-sm text-navy-600">{client.phone}</span>
                          ) : (
                            <span className="text-xs text-navy-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {client.email ? (
                            <span className="text-sm text-navy-500 truncate max-w-[180px] block">{client.email}</span>
                          ) : (
                            <span className="text-xs text-navy-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {can('canEditClients') && (
                              <button onClick={() => handleEdit(client)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-navy-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                                <Edit size={15} />
                              </button>
                            )}
                            {can('canDeleteClients') && (
                              <button onClick={() => handleDelete(client)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-navy-400 hover:bg-red-50 hover:text-accent-red transition-colors">
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={sortedClients.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
              pageSizeOptions={[25, 50, 100, 200]}
            />
          </>
        )}
      </div>

      {/* Client Form Modal */}
      {formOpen && (
        <ClientFormModal open={formOpen} onClose={() => { setFormOpen(false); setEditClient(null); }} client={editClient} />
      )}
    </div>
  );
}
