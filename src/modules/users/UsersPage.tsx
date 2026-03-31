import { useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, type PermissionKey } from '@/config/constants';
import { createUser, updateUser, updatePermissions } from './userService';
import type { AppUser } from '@/types';
import {
  Shield, Plus, Edit, Key, User, Phone, Mail, CreditCard, Lock,
} from 'lucide-react';

// Firebase config for secondary app (user creation)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyCSIZ00QQqAN_3bqj89r6YVrifZx9vGy20',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'alozo-2633a.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'alozo-2633a',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'alozo-2633a.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '711733152496',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:711733152496:web:98557b5691ba9ebcc51035',
};

// ============================
// USER FORM MODAL
// ============================
function UserFormModal({
  open, onClose, user,
}: {
  open: boolean; onClose: () => void; user: AppUser | null;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    nombre: user?.nombre || '',
    apellido: user?.apellido || '',
    cedula: user?.cedula || '',
    phone: user?.phone || '',
    correo: user?.correo || '',
    rol: (user?.rol || 'vendedor') as 'administrador' | 'vendedor',
    password: '',
  });
  const [saving, setSaving] = useState(false);

  function handleChange(field: string, value: string) {
    if (field === 'cedula' || field === 'phone') value = value.replace(/[^0-9]/g, '');
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!form.nombre || !form.correo) return toast.warning('Nombre y correo son obligatorios.');
    if (!user && !form.password) return toast.warning('La contraseña es obligatoria para nuevos usuarios.');
    if (!user && form.password.length < 6) return toast.warning('La contraseña debe tener al menos 6 caracteres.');

    setSaving(true);
    try {
      if (user) {
        await updateUser(user.id, form);
      } else {
        await createUser({ ...form, password: form.password }, firebaseConfig);
      }
      onClose();
      toast.success(user ? 'Usuario actualizado.' : 'Usuario creado exitosamente.');
    } catch (err: any) {
      console.error(err);
      if (err?.code === 'auth/email-already-in-use') toast.error('El correo ya está en uso.');
      else if (err?.code === 'auth/weak-password') toast.error('Contraseña muy débil (mínimo 6 caracteres).');
      else toast.error('Error: ' + (err?.message || 'Desconocido'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={user ? 'Editar Usuario' : 'Crear Usuario'} size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Nombre</label>
            <div className="relative">
              <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300" />
              <input value={form.nombre} onChange={(e) => handleChange('nombre', e.target.value)}
                className="input-field pl-10" placeholder="Juan" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Apellido</label>
            <input value={form.apellido} onChange={(e) => handleChange('apellido', e.target.value)}
              className="input-field" placeholder="Pérez" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Cédula</label>
            <div className="relative">
              <CreditCard size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300" />
              <input value={form.cedula} onChange={(e) => handleChange('cedula', e.target.value)}
                className="input-field pl-10" inputMode="numeric" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Teléfono</label>
            <div className="relative">
              <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300" />
              <input value={form.phone} onChange={(e) => handleChange('phone', e.target.value)}
                className="input-field pl-10" inputMode="numeric" />
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Correo</label>
          <div className="relative">
            <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300" />
            <input value={form.correo} onChange={(e) => handleChange('correo', e.target.value)}
              className="input-field pl-10" disabled={!!user} placeholder="correo@ejemplo.com" />
          </div>
          {user && <p className="text-[10px] text-navy-400 mt-1">El correo no se puede cambiar después de creado.</p>}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Rol</label>
            <select value={form.rol} onChange={(e) => handleChange('rol', e.target.value)} className="input-field">
              <option value="vendedor">Vendedor</option>
              <option value="administrador">Administrador</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">
              {user ? 'Nueva Contraseña' : 'Contraseña'}
            </label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300" />
              <input type="password" value={form.password} onChange={(e) => handleChange('password', e.target.value)}
                className="input-field pl-10" placeholder={user ? 'Dejar vacío para no cambiar' : 'Mínimo 6 caracteres'} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Guardando...' : user ? 'Actualizar' : 'Crear Usuario'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================
// PERMISSIONS MODAL
// ============================

// Group permissions by category for better UX
const PERMISSION_GROUPS = [
  { label: 'Acceso a Módulos', keys: ['canAccessVentas', 'canAccessInventario', 'canAccessClientes', 'canAccessDelivery', 'canAccessFacturas', 'canAccessInformes', 'canManageUsers'] as PermissionKey[] },
  { label: 'Productos', keys: ['canCreateProducts', 'canEditProducts', 'canDeleteProducts'] as PermissionKey[] },
  { label: 'Clientes', keys: ['canCreateClients', 'canEditClients', 'canDeleteClients'] as PermissionKey[] },
  { label: 'Operaciones', keys: ['canProcessReturns', 'canEditInvoices', 'canApplyDiscounts', 'canUpdateExchangeRate', 'canConfirmDeliveryPayment', 'canAddAbono'] as PermissionKey[] },
];

function PermissionsModal({
  open, onClose, user,
}: {
  open: boolean; onClose: () => void; user: AppUser;
}) {
  const toast = useToast();
  const initialPerms = user.permissions || DEFAULT_PERMISSIONS[user.rol] || DEFAULT_PERMISSIONS.vendedor;
  const [perms, setPerms] = useState<Record<PermissionKey, boolean>>({ ...initialPerms });
  const [saving, setSaving] = useState(false);

  function toggle(key: PermissionKey) {
    setPerms((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function selectAll(value: boolean) {
    const updated = { ...perms };
    Object.keys(ALL_PERMISSIONS).forEach((k) => { updated[k as PermissionKey] = value; });
    setPerms(updated);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updatePermissions(user.id, perms);
      onClose();
      toast.success('Permisos actualizados.');
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar permisos.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Permisos — ${user.nombre} ${user.apellido}`} size="lg">
      <div className="space-y-5">
        {/* Quick actions */}
        <div className="flex gap-2">
          <button onClick={() => selectAll(true)} className="btn-ghost text-xs text-emerald-600 hover:bg-emerald-50">Activar todos</button>
          <button onClick={() => selectAll(false)} className="btn-ghost text-xs text-accent-red hover:bg-red-50">Desactivar todos</button>
          <button onClick={() => setPerms({ ...DEFAULT_PERMISSIONS[user.rol] })} className="btn-ghost text-xs text-blue-600 hover:bg-blue-50">
            Restaurar por rol ({user.rol})
          </button>
        </div>

        {PERMISSION_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider mb-2">{group.label}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {group.keys.map((key) => (
                <label key={key}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-200
                    ${perms[key] ? 'border-emerald-200 bg-emerald-50/50' : 'border-surface-200 bg-white hover:bg-surface-50'}`}>
                  <input type="checkbox" checked={perms[key]} onChange={() => toggle(key)}
                    className="w-4 h-4 rounded border-surface-300 text-emerald-600 focus:ring-emerald-500/20" />
                  <span className={`text-sm font-display ${perms[key] ? 'text-emerald-800 font-medium' : 'text-navy-600'}`}>
                    {ALL_PERMISSIONS[key]}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Guardando...' : 'Guardar Permisos'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================
// MAIN USERS PAGE
// ============================
export function UsersPage() {
  const users = useAppStore((s) => s.users);
  const [formOpen, setFormOpen] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [permsUser, setPermsUser] = useState<AppUser | null>(null);

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-1 h-12 bg-indigo-500 rounded-full" />
            <div>
              <h1 className="text-xl font-display font-bold text-navy-900">Gestión de Usuarios</h1>
              <p className="text-navy-400 text-sm">{users.length} usuarios registrados</p>
            </div>
          </div>
          <button onClick={() => { setEditUser(null); setFormOpen(true); }} className="btn-primary text-sm">
            <Plus size={16} /> Nuevo Usuario
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        {users.length === 0 ? (
          <div className="p-12 text-center">
            <Shield size={40} className="mx-auto text-navy-200 mb-3" />
            <p className="text-navy-400 text-sm">No hay usuarios registrados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50">
                  {['Usuario', 'Cédula', 'Correo', 'Rol', 'Acciones'].map((h) => (
                    <th key={h} className={`text-${h === 'Acciones' ? 'right' : 'left'} text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider px-4 py-3`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {users.map((user: any) => (
                  <tr key={user.id} className="hover:bg-surface-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0
                          ${user.rol === 'administrador' ? 'bg-indigo-100' : 'bg-surface-100'}`}>
                          <span className={`text-xs font-display font-bold
                            ${user.rol === 'administrador' ? 'text-indigo-600' : 'text-navy-500'}`}>
                            {(user.nombre?.charAt(0) || '') + (user.apellido?.charAt(0) || '')}
                          </span>
                        </div>
                        <div>
                          <p className="font-display font-semibold text-navy-900 text-sm">{user.nombre} {user.apellido}</p>
                          <p className="text-[10px] text-navy-400">{user.phone || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-navy-500">{user.cedula || '—'}</td>
                    <td className="px-4 py-3 text-sm text-navy-500">{user.correo}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${user.rol === 'administrador' ? 'badge-purple' : 'badge-gray'}`}>
                        {user.rol === 'administrador' ? 'Admin' : 'Vendedor'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => { setEditUser(user); setFormOpen(true); }}
                          className="btn-ghost p-1.5 text-navy-400 hover:text-blue-600" title="Editar">
                          <Edit size={14} />
                        </button>
                        <button onClick={() => setPermsUser(user)}
                          className="btn-ghost p-1.5 text-navy-400 hover:text-indigo-600" title="Permisos">
                          <Key size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* User Form Modal */}
      {formOpen && (
        <UserFormModal open={formOpen} onClose={() => { setFormOpen(false); setEditUser(null); }} user={editUser} />
      )}

      {/* Permissions Modal */}
      {permsUser && (
        <PermissionsModal open={true} onClose={() => setPermsUser(null)} user={permsUser} />
      )}
    </div>
  );
}
