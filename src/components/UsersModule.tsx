import React, { useState } from 'react';
import { 
  Users, UserPlus, Shield, ShieldCheck, UserCheck, Search, 
  Trash2, Edit3, Lock, Eye, EyeOff, Sparkles, Key, AlertCircle, 
  CheckCircle2, X, RefreshCw, Clock, ShieldAlert 
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { UserAccount } from '../types';

export function UsersModule() {
  const { user, usersList, addUserAccount, updateUserAccount, deleteUserAccount, addNotification } = useAppContext();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user'>('all');
  
  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserAccount | null>(null);

  // Add Form State
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [showNewPassword, setShowNewPassword] = useState(true);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit Form State
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'user'>('user');
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Visible Passwords toggle per row ID
  const [visiblePasswordIds, setVisiblePasswordIds] = useState<Record<string, boolean>>({});

  // Security Wall Check
  if (!user || user.role !== 'admin') {
    return (
      <div className="flex-1 bg-[#FDFCFB] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-red-50 border border-red-200 rounded-full flex items-center justify-center text-red-600 mb-4 shadow-sm">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-serif text-[#1A1A1A] font-medium">Access Restricted</h2>
        <p className="text-sm text-[#8C8882] max-w-md mt-2 leading-relaxed">
          The Users module is restricted exclusively to system administrators. Log in with an admin account (e.g. <strong className="text-[#1A1A1A]">Aswath</strong>) to manage user accounts and permissions.
        </p>
      </div>
    );
  }

  // Filtered Users List
  const filteredUsers = usersList.filter(u => {
    const matchesSearch = u.username.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const totalUsers = usersList.length;
  const adminCount = usersList.filter(u => u.role === 'admin').length;
  const regularCount = usersList.filter(u => u.role === 'user').length;

  const togglePasswordVisibility = (id: string) => {
    setVisiblePasswordIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const generateRandomPassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let pass = '';
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pass;
  };

  const handleOpenAddModal = () => {
    setNewUsername('');
    setNewPassword(generateRandomPassword());
    setNewRole('user');
    setAddError(null);
    setIsAddModalOpen(true);
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);

    const result = addUserAccount({
      username: newUsername,
      password: newPassword,
      role: newRole,
    });

    if (result.success) {
      addNotification({
        type: 'success',
        title: 'User Created',
        message: `Successfully registered new account for "${newUsername.trim()}" (${newRole.toUpperCase()}).`
      });
      setIsAddModalOpen(false);
      setNewUsername('');
      setNewPassword('');
    } else {
      setAddError(result.error || 'Failed to create user');
    }
  };

  const handleOpenEditModal = (u: UserAccount) => {
    setEditingUser(u);
    setEditPassword(u.password || '');
    setEditRole(u.role);
    setEditError(null);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setEditError(null);

    const result = updateUserAccount(editingUser.id, {
      password: editPassword,
      role: editRole,
    });

    if (result.success) {
      addNotification({
        type: 'info',
        title: 'Account Updated',
        message: `Updated account details for "${editingUser.username}".`
      });
      setEditingUser(null);
    } else {
      setEditError(result.error || 'Failed to update user account');
    }
  };

  const handleDeleteConfirm = () => {
    if (!deletingUser) return;

    const result = deleteUserAccount(deletingUser.id);
    if (result.success) {
      addNotification({
        type: 'warning',
        title: 'User Removed',
        message: `User account "${deletingUser.username}" was deleted.`
      });
      setDeletingUser(null);
    } else {
      addNotification({
        type: 'error',
        title: 'Cannot Delete User',
        message: result.error || 'Operation failed.'
      });
      setDeletingUser(null);
    }
  };

  return (
    <div className="flex-1 bg-[#FDFCFB] flex flex-col overflow-y-auto font-sans text-[#1A1A1A]">
      {/* Top Banner Header */}
      <div className="border-b border-[#E5E2DE] bg-white px-8 py-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-7xl mx-auto">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-[#1A1A1A] text-white">
                Admin Exclusive
              </span>
              <h1 className="text-2xl font-serif text-[#1A1A1A]">User Account Management</h1>
            </div>
            <p className="text-xs text-[#8C8882] mt-1">
              Add, configure, and oversee user sign in credentials and authorization levels across Paxth Engine.
            </p>
          </div>

          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#1A1A1A] text-white text-xs uppercase tracking-widest font-bold rounded-sm hover:bg-[#333333] transition-colors shadow-sm self-start md:self-auto"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add New User</span>
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-7xl mx-auto mt-6 pt-6 border-t border-[#E5E2DE]">
          <div className="bg-[#FDFCFB] border border-[#E5E2DE] p-4 rounded-sm flex items-center gap-3">
            <div className="w-10 h-10 rounded-sm bg-[#1A1A1A]/5 border border-[#E5E2DE] flex items-center justify-center text-[#1A1A1A]">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#8C8882] font-semibold">Total Accounts</p>
              <p className="text-xl font-bold text-[#1A1A1A]">{totalUsers}</p>
            </div>
          </div>

          <div className="bg-[#FDFCFB] border border-[#E5E2DE] p-4 rounded-sm flex items-center gap-3">
            <div className="w-10 h-10 rounded-sm bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#8C8882] font-semibold">Administrators</p>
              <p className="text-xl font-bold text-[#1A1A1A]">{adminCount}</p>
            </div>
          </div>

          <div className="bg-[#FDFCFB] border border-[#E5E2DE] p-4 rounded-sm flex items-center gap-3">
            <div className="w-10 h-10 rounded-sm bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#8C8882] font-semibold">Regular Users</p>
              <p className="text-xl font-bold text-[#1A1A1A]">{regularCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls & Search Bar */}
      <div className="px-8 py-6 max-w-7xl w-full mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-4 border border-[#E5E2DE] rounded-sm">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-[#8C8882] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by username..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-[#FDFCFB] border border-[#E5E2DE] text-xs text-[#1A1A1A] rounded-sm focus:outline-none focus:border-[#1A1A1A]"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <span className="text-xs text-[#8C8882]">Filter Role:</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as any)}
              className="bg-[#FDFCFB] border border-[#E5E2DE] text-xs px-3 py-2 rounded-sm focus:outline-none focus:border-[#1A1A1A]"
            >
              <option value="all">All Roles ({usersList.length})</option>
              <option value="admin">Admins Only ({adminCount})</option>
              <option value="user">Users Only ({regularCount})</option>
            </select>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-white border border-[#E5E2DE] rounded-sm shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#FDFCFB] border-b border-[#E5E2DE] text-[10px] uppercase tracking-widest text-[#8C8882]">
                  <th className="py-3.5 px-6 font-semibold">User</th>
                  <th className="py-3.5 px-4 font-semibold">Role</th>
                  <th className="py-3.5 px-4 font-semibold">Sign In Password</th>
                  <th className="py-3.5 px-4 font-semibold">Created Date</th>
                  <th className="py-3.5 px-4 font-semibold">Last Active</th>
                  <th className="py-3.5 px-6 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E2DE] text-xs">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[#8C8882]">
                      <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p>No user accounts found matching your query.</p>
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const isVisible = !!visiblePasswordIds[u.id];
                    const isCurrentAdmin = user.username.toLowerCase() === u.username.toLowerCase();

                    return (
                      <tr key={u.id} className="hover:bg-[#FDFCFB] transition-colors">
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#1A1A1A] text-white flex items-center justify-center font-bold text-xs shrink-0">
                              {u.username.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-[#1A1A1A]">{u.username}</span>
                                {isCurrentAdmin && (
                                  <span className="text-[9px] uppercase px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold">
                                    You (Current)
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-[#8C8882] font-mono">{u.id}</span>
                            </div>
                          </div>
                        </td>

                        <td className="py-4 px-4">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            u.role === 'admin' 
                              ? 'bg-[#1A1A1A] text-white' 
                              : 'bg-[#E5E2DE]/60 text-[#1A1A1A]'
                          }`}>
                            {u.role === 'admin' ? <Shield className="w-3 h-3 text-emerald-400" /> : <Users className="w-3 h-3 text-[#8C8882]" />}
                            <span>{u.role}</span>
                          </span>
                        </td>

                        <td className="py-4 px-4 font-mono">
                          <div className="flex items-center gap-2">
                            <span className="bg-[#F5F2EF] px-2 py-1 rounded text-[11px] border border-[#E5E2DE] text-[#1A1A1A]">
                              {isVisible ? u.password : '••••••••••••'}
                            </span>
                            <button
                              onClick={() => togglePasswordVisibility(u.id)}
                              className="text-[#8C8882] hover:text-[#1A1A1A] transition-colors p-1"
                              title={isVisible ? "Hide Password" : "Show Password"}
                            >
                              {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>

                        <td className="py-4 px-4 text-[#8C8882]">
                          {new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </td>

                        <td className="py-4 px-4 text-[#8C8882]">
                          {u.lastLogin ? (
                            <span className="flex items-center gap-1 text-emerald-700 font-medium text-[11px]">
                              <Clock className="w-3 h-3" />
                              {new Date(u.lastLogin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          ) : (
                            <span className="text-[11px] italic">Never</span>
                          )}
                        </td>

                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleOpenEditModal(u)}
                              className="p-1.5 text-[#8C8882] hover:text-[#1A1A1A] hover:bg-[#F5F2EF] rounded transition-colors"
                              title="Edit User Credentials/Role"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => setDeletingUser(u)}
                              disabled={isCurrentAdmin || u.username.toLowerCase() === 'aswath'}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                              title={isCurrentAdmin ? "Cannot delete active logged in account" : "Delete User"}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal: Add New User */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E2DE] rounded-sm shadow-2xl max-w-md w-full p-6 animate-fadeIn">
            <div className="flex items-center justify-between pb-4 border-b border-[#E5E2DE]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-sm bg-[#1A1A1A] text-white flex items-center justify-center">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-serif font-medium text-[#1A1A1A]">Register New User</h3>
                  <p className="text-[11px] text-[#8C8882]">Create sign in credentials for system access.</p>
                </div>
              </div>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                className="text-[#8C8882] hover:text-[#1A1A1A] p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {addError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{addError}</span>
              </div>
            )}

            <form onSubmit={handleCreateUser} className="mt-5 space-y-4 text-xs">
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-[#1A1A1A] mb-1">
                  Sign In Username *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. JohnDoe"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E5E2DE] rounded-sm text-xs text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] uppercase tracking-widest font-bold text-[#1A1A1A]">
                    Password *
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewPassword(generateRandomPassword())}
                    className="text-[10px] text-[#1A1A1A] hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Generate Random</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 border border-[#E5E2DE] rounded-sm text-xs font-mono text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8C8882] hover:text-[#1A1A1A]"
                  >
                    {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-[#1A1A1A] mb-1">
                  Account Role
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as any)}
                  className="w-full px-3 py-2 border border-[#E5E2DE] rounded-sm text-xs text-[#1A1A1A] bg-white focus:outline-none focus:border-[#1A1A1A]"
                >
                  <option value="user">User (Standard Access)</option>
                  <option value="admin">Admin (Full Control + User Management)</option>
                </select>
              </div>

              <div className="pt-4 border-t border-[#E5E2DE] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs uppercase tracking-wider text-[#8C8882] hover:bg-[#F5F2EF] rounded-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs uppercase tracking-wider font-bold bg-[#1A1A1A] text-white hover:bg-[#333333] rounded-sm transition-colors shadow-sm"
                >
                  Save & Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit User */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E2DE] rounded-sm shadow-2xl max-w-md w-full p-6 animate-fadeIn">
            <div className="flex items-center justify-between pb-4 border-b border-[#E5E2DE]">
              <div>
                <h3 className="text-base font-serif font-medium text-[#1A1A1A]">Edit Credentials: {editingUser.username}</h3>
                <p className="text-[11px] text-[#8C8882]">Update sign in password or assigned role.</p>
              </div>
              <button 
                onClick={() => setEditingUser(null)}
                className="text-[#8C8882] hover:text-[#1A1A1A] p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="mt-5 space-y-4 text-xs">
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-[#8C8882] mb-1">
                  Username (Immutable)
                </label>
                <input
                  type="text"
                  disabled
                  value={editingUser.username}
                  className="w-full px-3 py-2 border border-[#E5E2DE] bg-[#F5F2EF] rounded-sm text-xs text-[#8C8882] cursor-not-allowed"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] uppercase tracking-widest font-bold text-[#1A1A1A]">
                    New Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setEditPassword(generateRandomPassword())}
                    className="text-[10px] text-[#1A1A1A] hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Generate New</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showEditPassword ? 'text' : 'password'}
                    required
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 border border-[#E5E2DE] rounded-sm text-xs font-mono text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword(!showEditPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8C8882] hover:text-[#1A1A1A]"
                  >
                    {showEditPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-[#1A1A1A] mb-1">
                  Role
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as any)}
                  className="w-full px-3 py-2 border border-[#E5E2DE] rounded-sm text-xs text-[#1A1A1A] bg-white focus:outline-none focus:border-[#1A1A1A]"
                >
                  <option value="user">User (Standard Access)</option>
                  <option value="admin">Admin (Full Control)</option>
                </select>
              </div>

              <div className="pt-4 border-t border-[#E5E2DE] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 text-xs uppercase tracking-wider text-[#8C8882] hover:bg-[#F5F2EF] rounded-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs uppercase tracking-wider font-bold bg-[#1A1A1A] text-white hover:bg-[#333333] rounded-sm transition-colors shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Confirmation */}
      {deletingUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E2DE] rounded-sm shadow-2xl max-w-sm w-full p-6 text-center animate-fadeIn">
            <div className="w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-serif font-medium text-[#1A1A1A]">Delete User Account</h3>
            <p className="text-xs text-[#8C8882] mt-2 leading-relaxed">
              Are you sure you want to permanently delete the account for <strong className="text-[#1A1A1A]">{deletingUser.username}</strong>? This user will no longer be able to log in.
            </p>

            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={() => setDeletingUser(null)}
                className="px-4 py-2 text-xs uppercase tracking-wider text-[#8C8882] hover:bg-[#F5F2EF] rounded-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 text-xs uppercase tracking-wider font-bold bg-red-600 text-white hover:bg-red-700 rounded-sm transition-colors shadow-sm"
              >
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
