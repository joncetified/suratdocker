import { CommonModule, registerLocaleData } from '@angular/common';
import localeId from '@angular/common/locales/id';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Role = 'WARGA' | 'PETUGAS' | 'KASI' | 'LURAH' | 'ADMIN' | 'SUPER_ADMIN';

interface User {
  id: number;
  nik?: string;
  name: string;
  email: string;
  role: Role;
  employeeNumber?: string;
  employee_number?: string;
  position?: string;
  phone?: string;
  address?: string;
  is_active?: boolean;
  isActive?: boolean;
  last_login_at?: string;
  lastLoginAt?: string;
  email_verified_at?: string;
  emailVerifiedAt?: string;
  pagePermissions?: string[];
  created_by_name?: string;
  updated_by_name?: string;
}

interface DocumentItem {
  id: number;
  type: string;
  name: string;
  mimeType: string;
  size: number;
}

interface Application {
  id: number;
  submission_code: string;
  applicant_name: string;
  applicant_email: string;
  nik: string;
  full_name: string;
  birth_place: string;
  birth_date: string;
  origin_address: string;
  domicile_address: string;
  neighborhood?: string;
  village: string;
  district: string;
  stay_duration: string;
  purpose: string;
  status: string;
  current_note?: string;
  letter_number?: string;
  pickup_code?: string;
  pickup_at?: string;
  submitted_at?: string;
  updated_at: string;
  documents: DocumentItem[];
}

interface SiteSettings {
  company_name: string;
  logo_data?: string;
  address: string;
  manager_name: string;
  contact_phone?: string;
  contact_email?: string;
  contact_whatsapp?: string;
  created_by_name?: string;
  updated_by_name?: string;
}

interface PageDefinition {
  code: string;
  label: string;
  description: string;
  allowed?: boolean;
}

interface IncomeEntry {
  id: number;
  entry_date: string;
  amount: string | number;
  description: string;
  created_by_name?: string;
  updated_by_name?: string;
}

interface BackupItem {
  id: number;
  filename: string;
  checksum_sha256: string;
  size_bytes: number;
  created_by_name?: string;
  created_at: string;
}

interface TrashRecord {
  id: number;
  type: 'USER' | 'APPLICATION' | 'INCOME';
  title: string;
  subtitle: string;
  deleted_at: string;
  deleted_by_name?: string;
}

registerLocaleData(localeId);

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  private readonly api = '/api';

  user: User | null = null;
  applications: Application[] = [];
  users: User[] = [];
  selected: Application | null = null;
  history: any[] = [];
  activePage = 'dashboard';
  mobileMenu = false;
  busy = false;
  toast = '';
  error = '';
  actionNote = '';
  pickupAt = '';
  showLoginPassword = false;
  registerMode = false;
  forgotMode = false;
  resetMode = false;
  authNotice = '';
  emailPreviewUrl = '';
  pendingActivationEmail = '';
  resetToken = '';
  notFoundMessage = '';
  globalNotFound = false;
  siteSettings: SiteSettings = {
    company_name: 'Kelurahan Belian',
    address: 'Kelurahan Belian, Kecamatan Batam Kota',
    manager_name: 'Lurah Kelurahan Belian',
  };
  settingsForm = {
    companyName: '',
    logoData: null as string | null,
    address: '',
    managerName: '',
    contactPhone: '',
    contactEmail: '',
    contactWhatsapp: '',
  };
  accessPages: PageDefinition[] = [];
  accessUsers: User[] = [];
  selectedAccessUser: User | null = null;
  userPermissionForm: Record<string, boolean> = {};
  reportPeriod: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' = 'MONTHLY';
  chartType: 'BAR' | 'PIE' = 'BAR';
  report: any = { timeline: [], statuses: [], total: 0 };
  incomeSummary: any = { today: 0, yesterday: 0, this_month: 0, last_month: 0 };
  incomeEntries: IncomeEntry[] = [];
  incomeForm = {
    entryDate: new Date().toISOString().slice(0, 10),
    amount: 0,
    description: '',
  };
  backups: BackupItem[] = [];
  trashRecords: TrashRecord[] = [];
  auditLogs: any[] = [];
  importScope: 'users' | 'applications' | 'income' = 'users';
  importRecords: any[] = [];
  importFileName = '';
  temporaryImportPassword = '';

  loginForm = { email: '', password: '' };
  forgotForm = { identifier: '', channel: 'EMAIL' as 'EMAIL' | 'WHATSAPP' };
  resetForm = { newPassword: '', confirmPassword: '' };
  registerForm = {
    nik: '',
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    address: '',
    acceptedTerms: false,
  };
  employeeForm = {
    employeeNumber: '',
    name: '',
    email: '',
    password: '',
    role: 'PETUGAS' as Role,
    position: 'Petugas Pelayanan',
    phone: '',
  };
  profileForm = { name: '', phone: '', address: '' };
  passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
  applicationForm = {
    nik: '',
    fullName: '',
    birthPlace: 'Batam',
    birthDate: '',
    originAddress: '',
    domicileAddress: '',
    neighborhood: '',
    village: 'Belian',
    district: 'Batam Kota',
    stayDuration: '',
    purpose: '',
  };
  ktpFile?: File;
  kkFile?: File;
  supportingFile?: File;
  editingId: number | null = null;

  readonly statusLabels: Record<string, string> = {
    DRAF: 'Draf',
    DIAJUKAN: 'Diajukan',
    MENUNGGU_PEMERIKSAAN: 'Menunggu Pemeriksaan',
    PERLU_DIPERBAIKI: 'Perlu Diperbaiki',
    DIVERIFIKASI: 'Diverifikasi',
    MENUNGGU_PERSETUJUAN: 'Menunggu Persetujuan',
    DISETUJUI: 'Disetujui',
    SIAP_DIAMBIL: 'Siap Diambil',
    SELESAI: 'Selesai',
    DITOLAK: 'Ditolak',
    DIBATALKAN: 'Dibatalkan',
    DOKUMEN_TIDAK_LENGKAP: 'Dokumen Tidak Lengkap',
  };

  readonly roleLabels: Record<Role, string> = {
    WARGA: 'Warga / Pemohon',
    PETUGAS: 'Petugas Pelayanan',
    KASI: 'Kasi Pemerintahan',
    LURAH: 'Lurah',
    ADMIN: 'Administrator',
    SUPER_ADMIN: 'Super Admin',
  };

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadPublicSettings();
    this.globalNotFound = window.location.pathname !== '/';
    const query = new URLSearchParams(window.location.search);
    const verificationToken = query.get('verify');
    const passwordResetToken = query.get('reset');
    if (verificationToken) this.verifyEmail(verificationToken);
    if (passwordResetToken) {
      this.resetToken = passwordResetToken;
      this.resetMode = true;
      this.registerMode = false;
      this.forgotMode = false;
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    if (localStorage.getItem('suratapp_token')) this.restoreSession();
  }

  loadPublicSettings() {
    this.http.get<{ settings: SiteSettings; emailPreviewUrl?: string }>(
      `${this.api}/site-settings/public`,
    ).subscribe({
      next: ({ settings, emailPreviewUrl }) => {
        this.siteSettings = settings;
        this.emailPreviewUrl = emailPreviewUrl ?? '';
      },
      error: () => {},
    });
  }

  goHomeFrom404() {
    window.history.replaceState({}, document.title, '/');
    this.globalNotFound = false;
    this.activePage = this.user ? 'dashboard' : 'dashboard';
  }

  restoreSession() {
    this.http.get<{ user: User }>(`${this.api}/auth/me`).subscribe({
      next: ({ user }) => {
        this.user = user;
        this.syncProfileForm();
        this.loadData();
      },
      error: () => this.logout(),
    });
  }

  login() {
    this.busy = true;
    this.error = '';
    const credentials = { ...this.loginForm };
    this.http.post<{ token: string; user: User }>(`${this.api}/auth/login`, credentials)
      .subscribe({
        next: ({ token, user }) => {
          localStorage.setItem('suratapp_token', token);
          this.loginForm = { email: '', password: '' };
          this.showLoginPassword = false;
          this.user = user;
          this.syncProfileForm();
          this.busy = false;
          this.activePage = 'dashboard';
          this.loadData();
          this.notify(`Selamat datang, ${user.name}`);
        },
        error: (error) => {
          if (error.error?.code === 'EMAIL_NOT_VERIFIED') {
            this.pendingActivationEmail = credentials.email;
          }
          this.loginForm.password = '';
          this.showLoginPassword = false;
          this.handleError(error);
        },
      });
  }

  clearLoginFeedback() {
    this.error = '';
    this.pendingActivationEmail = '';
  }

  register() {
    if (this.registerForm.password !== this.registerForm.confirmPassword) {
      this.error = 'Konfirmasi password tidak sama.';
      return;
    }
    if (!this.registerForm.acceptedTerms) {
      this.error = 'Anda harus menyetujui pernyataan kebenaran data.';
      return;
    }
    this.busy = true;
    this.error = '';
    this.http.post<{ message: string; email: string }>(
      `${this.api}/auth/register`,
      this.registerForm,
    ).subscribe({
      next: ({ message, email }) => {
        this.busy = false;
        this.registerMode = false;
        this.pendingActivationEmail = email;
        this.loginForm.email = email;
        this.loginForm.password = '';
        this.authNotice = message;
        this.error = '';
      },
      error: (error) => this.handleError(error),
    });
  }

  verifyEmail(token: string) {
    this.busy = true;
    this.http.post<{ message: string }>(`${this.api}/auth/verify-email`, { token }).subscribe({
      next: ({ message }) => {
        this.busy = false;
        this.authNotice = message;
        this.registerMode = false;
        this.forgotMode = false;
        this.resetMode = false;
        window.history.replaceState({}, document.title, window.location.pathname);
      },
      error: (error) => {
        window.history.replaceState({}, document.title, window.location.pathname);
        this.handleError(error);
      },
    });
  }

  resendActivation() {
    const email = this.pendingActivationEmail || this.loginForm.email;
    if (!email) {
      this.error = 'Isi alamat email terlebih dahulu.';
      return;
    }
    this.busy = true;
    this.http.post<{ message: string }>(
      `${this.api}/auth/resend-activation`,
      { email },
    ).subscribe({
      next: ({ message }) => {
        this.busy = false;
        this.authNotice = message;
        this.error = '';
      },
      error: (error) => this.handleError(error),
    });
  }

  requestPasswordReset() {
    this.busy = true;
    this.error = '';
    this.http.post<{ message: string }>(
      `${this.api}/auth/password-reset/request`,
      this.forgotForm,
    ).subscribe({
      next: ({ message }) => {
        this.busy = false;
        this.authNotice = message;
        this.forgotMode = false;
      },
      error: (error) => this.handleError(error),
    });
  }

  confirmPasswordReset() {
    if (this.resetForm.newPassword !== this.resetForm.confirmPassword) {
      this.error = 'Konfirmasi password baru tidak sama.';
      return;
    }
    this.busy = true;
    this.error = '';
    this.http.post<{ message: string }>(
      `${this.api}/auth/password-reset/confirm`,
      { token: this.resetToken, newPassword: this.resetForm.newPassword },
    ).subscribe({
      next: ({ message }) => {
        this.busy = false;
        this.resetMode = false;
        this.resetToken = '';
        this.resetForm = { newPassword: '', confirmPassword: '' };
        this.authNotice = message;
      },
      error: (error) => this.handleError(error),
    });
  }

  logout() {
    const token = localStorage.getItem('suratapp_token');
    if (token) {
      this.http.post(
        `${this.api}/auth/logout`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      ).subscribe({ error: () => {} });
    }
    localStorage.removeItem('suratapp_token');
    this.user = null;
    this.loginForm = { email: '', password: '' };
    this.forgotForm = { identifier: '', channel: 'EMAIL' };
    this.resetForm = { newPassword: '', confirmPassword: '' };
    this.registerForm = {
      nik: '',
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      phone: '',
      address: '',
      acceptedTerms: false,
    };
    this.employeeForm = {
      employeeNumber: '',
      name: '',
      email: '',
      password: '',
      role: 'PETUGAS',
      position: 'Petugas Pelayanan',
      phone: '',
    };
    this.profileForm = { name: '', phone: '', address: '' };
    this.passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
    this.settingsForm = {
      companyName: '',
      logoData: null,
      address: '',
      managerName: '',
      contactPhone: '',
      contactEmail: '',
      contactWhatsapp: '',
    };
    this.incomeForm = {
      entryDate: new Date().toISOString().slice(0, 10),
      amount: 0,
      description: '',
    };
    this.applicationForm = {
      nik: '',
      fullName: '',
      birthPlace: 'Batam',
      birthDate: '',
      originAddress: '',
      domicileAddress: '',
      neighborhood: '',
      village: 'Belian',
      district: 'Batam Kota',
      stayDuration: '',
      purpose: '',
    };
    this.applications = [];
    this.users = [];
    this.selected = null;
    this.history = [];
    this.accessPages = [];
    this.accessUsers = [];
    this.selectedAccessUser = null;
    this.userPermissionForm = {};
    this.report = { timeline: [], statuses: [], total: 0 };
    this.incomeSummary = { today: 0, yesterday: 0, this_month: 0, last_month: 0 };
    this.incomeEntries = [];
    this.backups = [];
    this.trashRecords = [];
    this.auditLogs = [];
    this.importRecords = [];
    this.importFileName = '';
    this.temporaryImportPassword = '';
    this.ktpFile = undefined;
    this.kkFile = undefined;
    this.supportingFile = undefined;
    this.editingId = null;
    this.actionNote = '';
    this.pickupAt = '';
    this.pendingActivationEmail = '';
    this.authNotice = '';
    this.error = '';
    this.toast = '';
    this.busy = false;
    this.showLoginPassword = false;
    this.mobileMenu = false;
    this.activePage = 'dashboard';
  }

  loadData() {
    if (this.hasPage('applications')) this.loadApplications();
    if (this.hasPage('users')) this.loadUsers();
    if (this.hasPage('income')) this.loadIncome();
  }

  hasPage(page: string) {
    return this.user?.role === 'SUPER_ADMIN'
      || Boolean(this.user?.pagePermissions?.includes(page));
  }

  loadApplications() {
    this.http.get<{ applications: Application[] }>(`${this.api}/applications`)
      .subscribe({
        next: ({ applications }) => this.applications = applications,
        error: (error) => this.handleError(error),
      });
  }

  loadUsers() {
    this.http.get<{ users: User[] }>(`${this.api}/users`).subscribe({
      next: ({ users }) => this.users = users,
      error: (error) => this.handleError(error),
    });
  }

  navigate(page: string) {
    const pagePermission: Record<string, string> = {
      dashboard: 'dashboard',
      applications: 'applications',
      detail: 'applications',
      new: 'new_application',
      users: 'users',
      'new-employee': 'users',
      permissions: 'permissions',
      settings: 'settings',
      reports: 'reports',
      income: 'income',
      'data-tools': 'data_tools',
      backups: 'backups',
      trash: 'trash',
      flow: 'flow',
      profile: 'profile',
    };
    const required = pagePermission[page];
    if (required && !this.hasPage(required)) {
      this.notFoundMessage = 'Akun Anda tidak mempunyai akses ke halaman ini.';
      this.activePage = 'error';
      return;
    }
    this.activePage = page;
    this.mobileMenu = false;
    if (page === 'new' && !this.editingId) this.resetApplicationForm();
    if (page !== 'new') this.editingId = null;
    if (page !== 'detail') this.selected = null;
    if (page === 'profile') this.syncProfileForm();
    if (page === 'permissions') this.loadAccessPages();
    if (page === 'settings') this.loadSettings();
    if (page === 'reports') this.loadReport();
    if (page === 'income') this.loadIncome();
    if (page === 'backups') this.loadBackups();
    if (page === 'trash') this.loadTrash();
  }

  resetApplicationForm() {
    this.applicationForm = {
      nik: this.user?.nik || '',
      fullName: this.user?.name || '',
      birthPlace: 'Batam',
      birthDate: '',
      originAddress: '',
      domicileAddress: '',
      neighborhood: '',
      village: 'Belian',
      district: 'Batam Kota',
      stayDuration: '',
      purpose: '',
    };
    this.ktpFile = undefined;
    this.kkFile = undefined;
    this.supportingFile = undefined;
  }

  openDetail(item: Application) {
    this.busy = true;
    this.http.get<{ application: Application; history: any[] }>(
      `${this.api}/applications/${item.id}`,
    ).subscribe({
      next: ({ application, history }) => {
        this.selected = application;
        this.history = history;
        this.actionNote = '';
        this.pickupAt = '';
        this.activePage = 'detail';
        this.busy = false;
        if (this.user?.role === 'SUPER_ADMIN') {
          this.loadAuditLogs('APPLICATION', application.id);
        }
      },
      error: (error) => this.handleError(error),
    });
  }

  fileSelected(event: Event, kind: 'ktp' | 'kk' | 'supporting') {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (kind === 'ktp') this.ktpFile = file;
    if (kind === 'kk') this.kkFile = file;
    if (kind === 'supporting') this.supportingFile = file;
  }

  submitApplication(mode: 'draft' | 'submit' = 'submit') {
    if (mode === 'submit' && !this.editingId && (!this.ktpFile || !this.kkFile)) {
      this.error = 'KTP dan KK wajib dipilih.';
      return;
    }
    const body = new FormData();
    Object.entries(this.applicationForm).forEach(([key, value]) => body.append(key, value));
    body.append('submissionMode', mode);
    if (this.ktpFile) body.append('ktp', this.ktpFile);
    if (this.kkFile) body.append('kk', this.kkFile);
    if (this.supportingFile) body.append('pendukung', this.supportingFile);

    this.busy = true;
    this.error = '';
    const request = this.editingId
      ? this.http.put(`${this.api}/applications/${this.editingId}`, body)
      : this.http.post(`${this.api}/applications`, body);
    request.subscribe({
      next: () => {
        this.busy = false;
        this.notify(mode === 'draft'
          ? 'Draf pengajuan berhasil disimpan.'
          : this.editingId
            ? 'Pengajuan berhasil dikirim kembali ke Petugas Pelayanan.'
            : 'Pengajuan berhasil dikirim ke Petugas Pelayanan.');
        this.editingId = null;
        this.resetApplicationForm();
        this.navigate('applications');
        this.loadApplications();
      },
      error: (error) => this.handleError(error),
    });
  }

  performAction(action: string) {
    if (!this.selected) return;
    let normalizedPickupAt: string | null = null;
    if (this.pickupAt) {
      const parsedPickupAt = new Date(this.pickupAt);
      if (Number.isNaN(parsedPickupAt.getTime())) {
        this.error = 'Jadwal pengambilan tidak valid.';
        return;
      }
      normalizedPickupAt = parsedPickupAt.toISOString();
    }
    this.busy = true;
    this.error = '';
    this.http.post<{ application: Application }>(
      `${this.api}/applications/${this.selected.id}/actions`,
      { action, note: this.actionNote, pickupAt: normalizedPickupAt },
    ).subscribe({
      next: ({ application }) => {
        this.busy = false;
        this.notify('Status pengajuan berhasil diperbarui.');
        this.loadApplications();
        this.openDetail(application);
      },
      error: (error) => this.handleError(error),
    });
  }

  editSelected() {
    if (!this.selected) return;
    this.editingId = this.selected.id;
    this.applicationForm = {
      nik: this.selected.nik,
      fullName: this.selected.full_name,
      birthPlace: this.selected.birth_place,
      birthDate: this.selected.birth_date.slice(0, 10),
      originAddress: this.selected.origin_address,
      domicileAddress: this.selected.domicile_address,
      neighborhood: this.selected.neighborhood || '',
      village: this.selected.village,
      district: this.selected.district,
      stayDuration: this.selected.stay_duration,
      purpose: this.selected.purpose,
    };
    this.ktpFile = undefined;
    this.kkFile = undefined;
    this.supportingFile = undefined;
    this.activePage = 'new';
    this.selected = null;
  }

  updateUser(item: User) {
    this.http.patch(`${this.api}/users/${item.id}`, {
      role: item.role,
      isActive: item.is_active,
    }).subscribe({
      next: () => this.notify(`Akun ${item.name} diperbarui.`),
      error: (error) => this.handleError(error),
    });
  }

  canEditUser(item: User) {
    if (!this.user || item.id === this.user.id) return false;
    return item.role !== 'SUPER_ADMIN' || this.user.role === 'SUPER_ADMIN';
  }

  canDeleteUser(item: User) {
    if (!this.user || item.id === this.user.id) return false;
    return this.user.role === 'SUPER_ADMIN'
      || !['ADMIN', 'SUPER_ADMIN'].includes(item.role);
  }

  createEmployee() {
    this.busy = true;
    this.error = '';
    this.http.post<{ user: User }>(`${this.api}/users`, this.employeeForm).subscribe({
      next: ({ user }) => {
        this.busy = false;
        this.notify(`Akun ${user.name} berhasil dibuat.`);
        this.employeeForm = {
          employeeNumber: '',
          name: '',
          email: '',
          password: '',
          role: 'PETUGAS',
          position: 'Petugas Pelayanan',
          phone: '',
        };
        this.loadUsers();
      },
      error: (error) => this.handleError(error),
    });
  }

  syncEmployeePosition() {
    const positions: Partial<Record<Role, string>> = {
      PETUGAS: 'Petugas Pelayanan',
      KASI: 'Kasi Pemerintahan',
      LURAH: 'Lurah / Pejabat Penandatangan',
      ADMIN: 'Administrator Sistem',
      SUPER_ADMIN: 'Super Administrator Sistem',
    };
    this.employeeForm.position = positions[this.employeeForm.role] ?? '';
  }

  syncProfileForm() {
    if (!this.user) return;
    this.profileForm = {
      name: this.user.name,
      phone: this.user.phone ?? '',
      address: this.user.address ?? '',
    };
  }

  updateProfile() {
    this.busy = true;
    this.error = '';
    this.http.patch<{ user: User }>(`${this.api}/profile`, this.profileForm).subscribe({
      next: ({ user }) => {
        this.user = user;
        this.busy = false;
        this.notify('Profil berhasil diperbarui.');
      },
      error: (error) => this.handleError(error),
    });
  }

  changePassword() {
    if (this.passwordForm.newPassword !== this.passwordForm.confirmPassword) {
      this.error = 'Konfirmasi password baru tidak sama.';
      return;
    }
    this.busy = true;
    this.error = '';
    this.http.post(`${this.api}/auth/change-password`, {
      currentPassword: this.passwordForm.currentPassword,
      newPassword: this.passwordForm.newPassword,
    }).subscribe({
      next: () => {
        this.busy = false;
        this.passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
        this.logout();
        this.notify('Password berhasil diubah. Silakan login kembali.');
      },
      error: (error) => this.handleError(error),
    });
  }

  openDocument(document: DocumentItem) {
    this.http.get(`${this.api}/documents/${document.id}`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank', 'noopener,noreferrer');
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },
        error: (error) => this.handleError(error),
      });
  }

  printPage() {
    window.print();
  }

  countStatus(status: string) {
    return this.applications.filter((item) => item.status === status).length;
  }

  private taskStatusesForRole() {
    const statuses: Partial<Record<Role, string[]>> = {
      PETUGAS: ['MENUNGGU_PEMERIKSAAN', 'DISETUJUI', 'SIAP_DIAMBIL'],
      KASI: ['DIVERIFIKASI'],
      LURAH: ['MENUNGGU_PERSETUJUAN'],
      WARGA: ['PERLU_DIPERBAIKI'],
    };
    return statuses[this.user?.role as Role] ?? [];
  }

  tasksForRole() {
    const statuses = this.taskStatusesForRole();
    return this.applications.filter((item) => statuses.includes(item.status));
  }

  pendingForRole() {
    return this.tasksForRole().length;
  }

  isWorkflowOfficer() {
    return ['PETUGAS', 'KASI', 'LURAH'].includes(this.user?.role ?? '');
  }

  roleTaskDescription() {
    const descriptions: Partial<Record<Role, string>> = {
      PETUGAS: 'Periksa kelengkapan awal, jadwalkan pengambilan, dan serahkan surat.',
      KASI: 'Pastikan kebenaran data serta wilayah domisili sebelum diteruskan kepada Lurah.',
      LURAH: 'Berikan keputusan dan persetujuan akhir pada pengajuan yang telah diverifikasi.',
    };
    return descriptions[this.user?.role as Role] ?? '';
  }

  taskActionLabel(status: string) {
    const labels: Record<string, string> = {
      MENUNGGU_PEMERIKSAAN: 'Periksa formulir dan dokumen',
      DIVERIFIKASI: 'Verifikasi kebenaran data dan wilayah',
      MENUNGGU_PERSETUJUAN: 'Berikan keputusan akhir',
      DISETUJUI: 'Tentukan jadwal pengambilan',
      SIAP_DIAMBIL: 'Periksa kode lalu serahkan surat',
    };
    return labels[status] ?? 'Buka pengajuan';
  }

  statusClass(status: string) {
    if (['SELESAI', 'DISETUJUI', 'SIAP_DIAMBIL'].includes(status)) return 'success';
    if (['DITOLAK', 'DIBATALKAN'].includes(status)) return 'danger';
    if (['PERLU_DIPERBAIKI', 'DOKUMEN_TIDAK_LENGKAP'].includes(status)) return 'warning';
    return 'info';
  }

  can(action: string) {
    if (!this.user || !this.selected) return false;
    const key = `${this.user.role}:${this.selected.status}`;
    const rules: Record<string, string[]> = {
      'PETUGAS:MENUNGGU_PEMERIKSAAN': ['REQUEST_REVISION', 'VERIFY'],
      'PETUGAS:DISETUJUI': ['SCHEDULE'],
      'PETUGAS:SIAP_DIAMBIL': ['COMPLETE'],
      'KASI:DIVERIFIKASI': ['RETURN', 'REJECT', 'APPROVE'],
      'LURAH:MENUNGGU_PERSETUJUAN': ['REJECT', 'APPROVE'],
      'WARGA:PERLU_DIPERBAIKI': ['RESUBMIT', 'CANCEL'],
      'WARGA:MENUNGGU_PEMERIKSAAN': ['CANCEL'],
      'WARGA:DRAF': ['EDIT_DRAFT', 'CANCEL'],
    };
    return (rules[key] ?? []).includes(action);
  }

  loadAccessPages() {
    this.http.get<{ pages: PageDefinition[]; users: User[] }>(`${this.api}/access/pages`)
      .subscribe({
        next: ({ pages, users }) => {
          this.accessPages = pages;
          this.accessUsers = users;
          if (this.selectedAccessUser) {
            const refreshed = users.find((item) => item.id === this.selectedAccessUser?.id);
            if (refreshed) this.selectAccessUser(refreshed);
          }
        },
        error: (error) => this.handleError(error),
      });
  }

  selectAccessUser(user: User) {
    this.selectedAccessUser = user;
    this.http.get<{ permissions: PageDefinition[] }>(
      `${this.api}/access/users/${user.id}`,
    ).subscribe({
      next: ({ permissions }) => {
        this.accessPages = permissions;
        this.userPermissionForm = Object.fromEntries(
          permissions.map((item) => [item.code, Boolean(item.allowed)]),
        );
      },
      error: (error) => this.handleError(error),
    });
  }

  savePagePermissions() {
    if (!this.selectedAccessUser) return;
    this.busy = true;
    this.http.put(
      `${this.api}/access/users/${this.selectedAccessUser.id}`,
      { permissions: this.userPermissionForm },
    ).subscribe({
      next: () => {
        this.busy = false;
        this.notify('Hak akses halaman berhasil disimpan.');
      },
      error: (error) => this.handleError(error),
    });
  }

  loadSettings() {
    this.http.get<{ settings: SiteSettings }>(`${this.api}/site-settings`).subscribe({
      next: ({ settings }) => {
        this.siteSettings = settings;
        this.settingsForm = {
          companyName: settings.company_name,
          logoData: settings.logo_data ?? null,
          address: settings.address,
          managerName: settings.manager_name,
          contactPhone: settings.contact_phone ?? '',
          contactEmail: settings.contact_email ?? '',
          contactWhatsapp: settings.contact_whatsapp ?? '',
        };
      },
      error: (error) => this.handleError(error),
    });
  }

  logoSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      this.error = 'Ukuran logo maksimal 1 MB.';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.settingsForm.logoData = String(reader.result);
    reader.readAsDataURL(file);
  }

  saveSettings() {
    this.busy = true;
    this.http.put<{ settings: SiteSettings }>(
      `${this.api}/site-settings`,
      this.settingsForm,
    ).subscribe({
      next: ({ settings }) => {
        this.busy = false;
        this.siteSettings = settings;
        this.notify('Pengaturan website berhasil disimpan.');
      },
      error: (error) => this.handleError(error),
    });
  }

  loadReport() {
    this.http.get<any>(
      `${this.api}/reports/applications?period=${this.reportPeriod}`,
    ).subscribe({
      next: (report) => this.report = report,
      error: (error) => this.handleError(error),
    });
  }

  reportBarHeight(count: number) {
    const max = Math.max(1, ...this.report.timeline.map((item: any) => Number(item.count)));
    return `${Math.max(8, (Number(count) / max) * 100)}%`;
  }

  reportBucketLabel(value: string) {
    const date = new Date(value);
    if (this.reportPeriod === 'YEARLY') return String(date.getFullYear());
    if (this.reportPeriod === 'MONTHLY') {
      return date.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
    }
    return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
  }

  pieGradient() {
    const colors = ['#176b4d', '#2e86ab', '#f2a93b', '#b94b55', '#7559a6', '#4b8f8c'];
    const total = Math.max(
      1,
      this.report.statuses.reduce((sum: number, item: any) => sum + Number(item.count), 0),
    );
    let cursor = 0;
    const stops = this.report.statuses.map((item: any, index: number) => {
      const start = cursor;
      cursor += (Number(item.count) / total) * 100;
      return `${colors[index % colors.length]} ${start}% ${cursor}%`;
    });
    return `conic-gradient(${stops.join(',') || '#e5e9e6 0 100%'})`;
  }

  reportColor(index: number) {
    return ['#176b4d', '#2e86ab', '#f2a93b', '#b94b55', '#7559a6', '#4b8f8c'][index % 6];
  }

  loadIncome() {
    if (!this.hasPage('income')) return;
    this.http.get<{ summary: any }>(`${this.api}/income/summary`).subscribe({
      next: ({ summary }) => this.incomeSummary = summary,
      error: (error) => this.handleError(error),
    });
    this.http.get<{ entries: IncomeEntry[] }>(`${this.api}/income`).subscribe({
      next: ({ entries }) => this.incomeEntries = entries,
      error: (error) => this.handleError(error),
    });
  }

  createIncome() {
    this.busy = true;
    this.http.post(`${this.api}/income`, this.incomeForm).subscribe({
      next: () => {
        this.busy = false;
        this.incomeForm = {
          entryDate: new Date().toISOString().slice(0, 10),
          amount: 0,
          description: '',
        };
        this.notify('Pendapatan berhasil dicatat.');
        this.loadIncome();
      },
      error: (error) => this.handleError(error),
    });
  }

  deleteIncome(item: IncomeEntry) {
    if (!window.confirm(`Hapus data pendapatan "${item.description}"?`)) return;
    this.http.delete(`${this.api}/income/${item.id}`).subscribe({
      next: () => {
        this.notify('Data dipindahkan ke Data Terhapus.');
        this.loadIncome();
      },
      error: (error) => this.handleError(error),
    });
  }

  exportData(scope: 'users' | 'applications' | 'income', format: 'json' | 'csv') {
    this.http.get(
      `${this.api}/data/export?scope=${scope}&format=${format}`,
      { responseType: 'blob' },
    ).subscribe({
      next: (blob) => this.downloadBlob(
        blob,
        `${scope}-${new Date().toISOString().slice(0, 10)}.${format}`,
      ),
      error: (error) => this.handleError(error),
    });
  }

  importFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      this.importRecords = [];
      this.importFileName = '';
      this.error = 'Berkas import maksimal 5 MB.';
      (event.target as HTMLInputElement).value = '';
      return;
    }
    this.importFileName = file.name;
    file.text().then((content) => {
      try {
        const parsed = JSON.parse(content);
        this.importRecords = Array.isArray(parsed) ? parsed : parsed.records;
        if (!Array.isArray(this.importRecords) || this.importRecords.length > 2000) {
          throw new Error();
        }
        if (!Array.isArray(parsed) && ['users', 'applications', 'income'].includes(parsed.scope)) {
          this.importScope = parsed.scope;
        }
        this.error = '';
      } catch {
        this.importRecords = [];
        this.error = 'Berkas import harus berupa JSON SuratApp dan maksimal 2.000 baris.';
      }
    });
  }

  runImport() {
    if (!this.importRecords.length) {
      this.error = 'Pilih berkas JSON yang valid terlebih dahulu.';
      return;
    }
    this.busy = true;
    this.http.post<any>(`${this.api}/data/import`, {
      scope: this.importScope,
      records: this.importRecords,
      temporaryPassword: this.temporaryImportPassword,
    }).subscribe({
      next: ({ imported, skipped }) => {
        this.busy = false;
        this.notify(`Import selesai: ${imported} masuk, ${skipped} dilewati.`);
        this.importRecords = [];
        this.importFileName = '';
        this.temporaryImportPassword = '';
        this.loadData();
      },
      error: (error) => this.handleError(error),
    });
  }

  loadBackups() {
    this.http.get<{ backups: BackupItem[] }>(`${this.api}/backups`).subscribe({
      next: ({ backups }) => this.backups = backups,
      error: (error) => this.handleError(error),
    });
  }

  createBackup() {
    this.busy = true;
    this.http.post(`${this.api}/backups`, {}).subscribe({
      next: () => {
        this.busy = false;
        this.notify('Cadangan data aplikasi berhasil dibuat.');
        this.loadBackups();
      },
      error: (error) => this.handleError(error),
    });
  }

  downloadBackup(item: BackupItem) {
    this.http.get(`${this.api}/backups/${item.id}/download`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => this.downloadBlob(blob, item.filename),
        error: (error) => this.handleError(error),
      });
  }

  recoverDatabaseConnection() {
    this.busy = true;
    this.http.post<any>(`${this.api}/system/database/recover-connection`, {}).subscribe({
      next: ({ message }) => {
        this.busy = false;
        this.notify(message);
      },
      error: (error) => this.handleError(error),
    });
  }

  loadTrash() {
    this.http.get<{ records: TrashRecord[] }>(`${this.api}/trash`).subscribe({
      next: ({ records }) => this.trashRecords = records,
      error: (error) => this.handleError(error),
    });
    this.loadAuditLogs();
  }

  restoreRecord(item: TrashRecord) {
    this.http.post(`${this.api}/trash/${item.type}/${item.id}/restore`, {}).subscribe({
      next: () => {
        this.notify('Data berhasil dipulihkan.');
        this.loadTrash();
      },
      error: (error) => this.handleError(error),
    });
  }

  deleteUser(item: User) {
    if (!window.confirm(`Pindahkan akun ${item.name} ke Data Terhapus?`)) return;
    this.http.delete(`${this.api}/users/${item.id}`).subscribe({
      next: () => {
        this.notify('Akun dipindahkan ke Data Terhapus.');
        this.loadUsers();
      },
      error: (error) => this.handleError(error),
    });
  }

  deleteSelectedApplication() {
    if (!this.selected
      || !window.confirm(`Hapus pengajuan ${this.selected.submission_code}?`)) return;
    this.http.delete(`${this.api}/applications/${this.selected.id}`).subscribe({
      next: () => {
        this.notify('Pengajuan dipindahkan ke Data Terhapus.');
        this.loadApplications();
        this.navigate('applications');
      },
      error: (error) => this.handleError(error),
    });
  }

  loadAuditLogs(entityType = '', entityId?: number) {
    const query = new URLSearchParams();
    if (entityType) query.set('entityType', entityType);
    if (entityId) query.set('entityId', String(entityId));
    this.http.get<{ logs: any[] }>(
      `${this.api}/audit-logs${query.size ? `?${query}` : ''}`,
    ).subscribe({
      next: ({ logs }) => this.auditLogs = logs,
      error: (error) => this.handleError(error),
    });
  }

  downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  notify(message: string) {
    this.toast = message;
    setTimeout(() => this.toast = '', 3500);
  }

  handleError(error: HttpErrorResponse) {
    this.busy = false;
    const message = error.error?.message ?? 'Tidak dapat terhubung ke server.';
    if (error.status === 404) {
      this.notFoundMessage = message;
      this.activePage = 'error';
      this.error = '';
      return;
    }
    this.error = message;
  }
}
