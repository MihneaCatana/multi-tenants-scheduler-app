/**
 * Translations catalogue.
 * Keys are semantic strings; values are the locale-specific text.
 * Add new strings here first, then use them via `useT()`.
 */

export type Locale = 'en' | 'ro';

export interface Translations {
  // Navigation / Shell
  nav_staff: string;
  nav_clients: string;
  nav_calendar: string;
  nav_resources: string;
  nav_services: string;
  nav_profile: string;
  nav_signOut: string;
  nav_darkMode: string;
  nav_lightMode: string;

  // Auth
  auth_signIn: string;
  auth_signingIn: string;
  auth_emailLabel: string;
  auth_passwordLabel: string;
  auth_serverError: string;

  // Profile
  profile_title: string;
  profile_accountDetails: string;
  profile_email: string;
  profile_role: string;
  profile_firstName: string;
  profile_lastName: string;
  profile_preferences: string;
  profile_language: string;
  profile_languageHint: string;

  // Staff panel
  staff_title: string;
  staff_addButton: string;
  staff_description: string;
  staff_errorLoad: string;
  staff_empty: string;
  staff_colEmail: string;
  staff_colName: string;
  staff_colRole: string;
  staff_colStatus: string;
  staff_colActions: string;
  staff_tagYou: string;
  staff_statusActive: string;
  staff_statusInactive: string;
  staff_actionEdit: string;
  staff_actionResetPw: string;
  staff_actionDeactivate: string;
  staff_actionActivate: string;
  staff_actionDelete: string;
  staff_deleteTitle: string;
  staff_deleteBody: string;
  staff_deleteBtn: string;
  staff_deleteCancel: string;
  staff_deleteDeleting: string;

  // Edit modal
  staff_editTitle: string;
  staff_editCannotChangeRole: string;
  staff_editSaving: string;
  staff_editSave: string;
  staff_editCancelBtn: string;
  staff_editSaveFailed: string;

  // Reset pw modal
  staff_resetTitle: string;
  staff_resetTitleDone: string;
  staff_resetBody: string;
  staff_resetTempPwBody: string;
  staff_resetBtn: string;
  staff_resetResetting: string;
  staff_resetDone: string;
  staff_resetCopy: string;
  staff_resetCancel: string;

  // Create modal
  staff_createTitle: string;
  staff_createRoleNote: string;
  staff_createCreating: string;
  staff_createBtn: string;
  staff_createFailed: string;
  staff_createCancel: string;

  // Clients workspace
  clients_title: string;
  clients_viewingTenant: string;
  clients_description: string;
  clients_addButton: string;
  clients_errorLoad: string;
  clients_empty: string;
  clients_colName: string;
  clients_colEmail: string;
  clients_colPhone: string;
  clients_colCreated: string;
  clients_colActions: string;
  clients_actionEdit: string;
  clients_actionDelete: string;
  clients_deleteTitle: string;
  clients_deleteBody: string;
  clients_deleteBtn: string;
  clients_deleteCancel: string;
  clients_editTitle: string;
  clients_addTitle: string;
  clients_fieldName: string;
  clients_fieldEmail: string;
  clients_fieldPhone: string;
  clients_fieldNotes: string;
  clients_saving: string;
  clients_save: string;
  clients_cancel: string;
  clients_saveFailed: string;
  client_back: string;
  client_detailsTitle: string;
  client_notFound: string;
  client_noPhone: string;
  client_noEmail: string;
  client_noNotes: string;
  client_appointmentHistory: string;
  client_updated: string;
  client_financialSummary: string;
  client_totalSpent: string;
  client_completed: string;
  client_avgPerAppointment: string;
  client_upcoming: string;
  client_statusBreakdown: string;

  // Common
  common_cancel: string;
  common_minutes: string;
  common_save: string;
  common_loading: string;
  common_error: string;

  // Error codes (backend → frontend mapping)
  error_unknown: string;
  error_badRequest: string;
  error_unauthorized: string;
  error_forbidden: string;
  error_notFound: string;
  error_validationError: string;
  error_conflict: string;
  error_tooManyRequests: string;
  error_internal: string;

  // Auth error codes
  error_invalidCredentials: string;
  error_wrongPassword: string;
  error_invalidRefreshToken: string;
  error_tokenReuseDetected: string;
  error_tokenExpired: string;
  error_userGone: string;
  error_noRefreshToken: string;

  // Tenant error codes
  error_invalidSubdomain: string;
  error_subdomainTooShort: string;
  error_subdomainTaken: string;
  error_tenantInitFailed: string;
  error_alreadyActive: string;
  error_alreadyInactive: string;
  error_alreadySuspended: string;
  error_tenantConcurrentUpdate: string;

  // Staff error codes
  error_staffNotFound: string;
  error_cannotChangeOwnRole: string;
  error_cannotDeactivateSelf: string;
  error_emailTaken: string;
  error_alreadyDeleted: string;

  // Client error codes
  error_clientNotFound: string;

  // Feature flag error codes
  error_unknownFeatureKeys: string;

  // Zod validation error codes
  error_tooShort: string;
  error_tooLong: string;
  error_tooSmall: string;
  error_tooLarge: string;
  error_invalidEmail: string;
  error_invalidUuid: string;
  error_invalidString: string;
  error_invalidOption: string;
  error_invalidType: string;
  error_tooFewItems: string;
  error_tooManyItems: string;

  // Scheduling page
  sched_title: string;
  sched_unavailable: string;
  sched_tabAppointments: string;
  sched_tabCalendar: string;
  sched_tabResources: string;
  sched_tabServices: string;
  sched_newAppointment: string;
  sched_add: string;

  // Appointments tab
  appt_noAppointments: string;
  appt_colStart: string;
  appt_colEnd: string;
  appt_colDuration: string;
  appt_colResource: string;
  appt_colClient: string;
  appt_colService: string;
  appt_colStatus: string;
  appt_colSummary: string;
  appt_colActions: string;
  appt_srOpenMenu: string;
  appt_actionView: string;
  appt_actionCancel: string;
  appt_actionCheckIn: string;
  appt_actionStart: string;
  appt_actionComplete: string;
  appt_actionNoShow: string;
  appt_actionReschedule: string;
  appt_actionChangeStatus: string;
  appt_filterSearch: string;
  appt_filterSearchPlaceholder: string;
  appt_filterStatus: string;
  appt_filterResource: string;
  appt_filterClient: string;
  appt_filterFrom: string;
  appt_filterTo: string;
  appt_filterAll: string;
  appt_filterAllResources: string;
  appt_filterAllClients: string;
  appt_showingCount: string;
  appt_showingOf: string;
  appt_perPage: string;
  appt_errorLoad: string;

  // Calendar tab
  cal_walkIn: string;
  cal_today: string;
  cal_week: string;
  cal_day: string;
  cal_errorLoad: string;
  cal_dragError: string;

  // Resources tab
  res_addButton: string;
  res_errorLoad: string;
  res_noResources: string;
  res_colName: string;
  res_colType: string;
  res_colLinkedStaff: string;
  res_colStatus: string;
  res_colActions: string;
  res_statusActive: string;
  res_statusInactive: string;
  res_actionEdit: string;
  res_actionSchedule: string;
  res_actionDelete: string;
  res_deleteTitle: string;
  res_deleteBody: string;
  res_formEditTitle: string;
  res_formAddTitle: string;
  res_formSaving: string;
  res_formSaveChanges: string;
  res_formAdd: string;
  res_fieldName: string;
  res_fieldType: string;
  res_fieldLinkedStaff: string;
  res_fieldNotes: string;
  res_fieldActive: string;
  res_typeProvider: string;
  res_typeRoom: string;
  res_typeEquipment: string;
  res_typeChair: string;
  res_selectStaffPlaceholder: string;
  res_backToResources: string;
  res_workingHours: string;
  res_timeOff: string;
  res_addBtn: string;
  res_noWorkingHours: string;
  res_whColDay: string;
  res_whColStartTime: string;
  res_whColEndTime: string;
  res_whColValidFrom: string;
  res_whColValidTo: string;
  res_whOngoing: string;
  res_whEditTitle: string;
  res_whAddTitle: string;
  res_whFieldDayOfWeek: string;
  res_whFieldStartTime: string;
  res_whFieldEndTime: string;
  res_whFieldValidFrom: string;
  res_whFieldValidTo: string;
  res_whDeleteTitle: string;
  res_whDeleteBody: string;
  res_toAddTitle: string;
  res_toColStart: string;
  res_toColEnd: string;
  res_toColReason: string;
  res_toColActions: string;
  res_noTimeOff: string;
  res_toFieldStart: string;
  res_toFieldEnd: string;
  res_toFieldReason: string;
  res_toFieldReasonPlaceholder: string;
  res_toDeleteTitle: string;
  res_toDeleteBody: string;

  // Services tab
  svc_addButton: string;
  svc_noServices: string;
  svc_colName: string;
  svc_colCategory: string;
  svc_colDuration: string;
  svc_colBuffers: string;
  svc_colPrice: string;
  svc_colStatus: string;
  svc_colActions: string;
  svc_statusActive: string;
  svc_statusInactive: string;
  svc_actionEdit: string;
  svc_actionRequirements: string;
  svc_actionDelete: string;
  svc_durationMin: string;
  svc_bufferBeforeAfter: string;
  svc_formEditTitle: string;
  svc_formAddTitle: string;
  svc_fieldName: string;
  svc_fieldDescription: string;
  svc_fieldCategory: string;
  svc_fieldCategoryPlaceholder: string;
  svc_fieldDuration: string;
  svc_fieldBufferBefore: string;
  svc_fieldBufferAfter: string;
  svc_fieldPrice: string;
  svc_fieldStatus: string;
  svc_deleteTitle: string;
  svc_deleteBody: string;
  svc_reqTitle: string;
  svc_backToServices: string;
  svc_reqSaved: string;
  svc_reqErrorSave: string;
  svc_reqErrorLoad: string;
  svc_reqNoRequirements: string;
  svc_reqColResourceType: string;
  svc_reqColQuantity: string;
  svc_reqColRequired: string;
  svc_reqAddButton: string;
  svc_reqSaving: string;
  svc_reqSaveButton: string;

  // Appointment detail
  apptDet_title: string;
  apptDet_unavailable: string;
  apptDet_errorLoad: string;
  apptDet_backToAppointments: string;
  apptDet_start: string;
  apptDet_end: string;
  apptDet_duration: string;
  apptDet_client: string;
  apptDet_walkIn: string;
  apptDet_summary: string;
  apptDet_notes: string;
  apptDet_cancellationReason: string;
  apptDet_service: string;
  apptDet_resources: string;
  apptDet_statusHistory: string;
  apptDet_created: string;
  apptDet_cancelTitle: string;
  apptDet_cancelReasonLabel: string;
  apptDet_cancelButton: string;
  apptDet_rescheduleTitle: string;
  apptDet_rescheduleFieldNewStart: string;
  apptDet_rescheduleFieldDuration: string;
  apptDet_rescheduleFieldRequired: string;
  apptDet_rescheduleButton: string;
  apptDet_noteLabel: string;
  apptDet_actionNoteTitle: string;
  apptDet_googleCalendar: string;

  // Create appointment form
  apptCreate_title: string;
  apptCreate_clientLabel: string;
  apptCreate_walkInOption: string;
  apptCreate_providerLabel: string;
  apptCreate_roomLabel: string;
  apptCreate_noRoom: string;
  apptCreate_resourceLabel: string;
  apptCreate_additionalResourcesLabel: string;
  apptCreate_serviceLabel: string;
  apptCreate_durationLabel: string;
  apptCreate_startAtLabel: string;
  apptCreate_summaryLabel: string;
  apptCreate_notesLabel: string;
  apptCreate_selectPlaceholder: string;
  apptCreate_creating: string;
  apptCreate_create: string;
  apptCreate_endPreview: string;
  apptCreate_optionalDetails: string;

  // Lifecycle helpers (day labels, resource type labels)
  life_daySun: string;
  life_dayMon: string;
  life_dayTue: string;
  life_dayWed: string;
  life_dayThu: string;
  life_dayFri: string;
  life_daySat: string;
  life_typeProvider: string;
  life_typeRoom: string;
  life_typeEquipment: string;
  life_typeChair: string;
}

const en: Translations = {
  nav_staff: 'Staff',
  nav_clients: 'Clients',
  nav_calendar: 'Appointments',
  nav_resources: 'Resources',
  nav_services: 'Services',
  nav_profile: 'Profile',
  nav_signOut: 'Sign out',
  nav_darkMode: 'Dark mode',
  nav_lightMode: 'Light mode',

  auth_signIn: 'Sign in',
  auth_signingIn: 'Signing in…',
  auth_emailLabel: 'Email',
  auth_passwordLabel: 'Password',
  auth_serverError: 'Sign-in failed. Check your email and password.',

  profile_title: 'Profile',
  profile_accountDetails: 'Account Details',
  profile_email: 'Email Address',
  profile_role: 'Role',
  profile_firstName: 'First Name',
  profile_lastName: 'Last Name',
  profile_preferences: 'Preferences',
  profile_language: 'Display Language',
  profile_languageHint: 'Choose the language for the application interface.',

  staff_title: 'Staff',
  staff_addButton: 'Add staff',
  staff_description: 'Manage the staff in this tenant. Resetting a password generates a temporary password the staff member must change on next sign-in.',
  staff_errorLoad: 'Could not load staff.',
  staff_empty: 'No staff in this tenant.',
  staff_colEmail: 'Email',
  staff_colName: 'Name',
  staff_colRole: 'Role',
  staff_colStatus: 'Status',
  staff_colActions: 'Actions',
  staff_tagYou: '(you)',
  staff_statusActive: 'active',
  staff_statusInactive: 'inactive',
  staff_actionEdit: 'Edit',
  staff_actionResetPw: 'Reset pw',
  staff_actionDeactivate: 'Deactivate',
  staff_actionActivate: 'Activate',
  staff_actionDelete: 'Delete',
  staff_deleteTitle: 'Delete staff member?',
  staff_deleteBody: 'This will permanently remove {email} from this tenant. They will not be able to log in and all their sessions will be revoked.',
  staff_deleteBtn: 'Delete',
  staff_deleteCancel: 'Cancel',
  staff_deleteDeleting: 'Deleting…',

  staff_editTitle: 'Edit staff member',
  staff_editCannotChangeRole: 'You cannot change your own role.',
  staff_editSaving: 'Saving…',
  staff_editSave: 'Save',
  staff_editCancelBtn: 'Cancel',
  staff_editSaveFailed: 'Save failed',

  staff_resetTitle: 'Reset password?',
  staff_resetTitleDone: 'Temporary password',
  staff_resetBody: 'This will set a new temporary password for {email}, sign them out everywhere, and require them to choose a new password on next sign-in.',
  staff_resetTempPwBody: 'Temporary password for {email}. Share it securely — the staff member must change it on next sign-in.',
  staff_resetBtn: 'Reset password',
  staff_resetResetting: 'Resetting…',
  staff_resetDone: 'Done',
  staff_resetCopy: 'Copy',
  staff_resetCancel: 'Cancel',

  staff_createTitle: 'Add staff member',
  staff_createRoleNote: 'New staff are created as tenant_user. You can change their role after creation.',
  staff_createCreating: 'Creating…',
  staff_createBtn: 'Create',
  staff_createFailed: 'Create failed',
  staff_createCancel: 'Cancel',

  clients_title: 'Clients',
  clients_viewingTenant: 'Viewing data for tenant {subdomain}. Each tenant\'s clients live in a separate database — this list is isolated to this tenant.',
  clients_description: "Each tenant's clients live in a separate database — this list is isolated to this tenant.",
  clients_addButton: 'Add client',
  clients_errorLoad: 'Could not load clients.',
  clients_empty: 'No clients yet. Add one to see it isolated to this tenant.',
  clients_colName: 'Name',
  clients_colEmail: 'Email',
  clients_colPhone: 'Phone',
  clients_colCreated: 'Created',
  clients_colActions: 'Actions',
  clients_actionEdit: 'Edit',
  clients_actionDelete: 'Delete',
  clients_deleteTitle: 'Delete client?',
  clients_deleteBody: 'Are you sure you want to delete {name}? This action can be undone by a database administrator.',
  clients_deleteBtn: 'Delete',
  clients_deleteCancel: 'Cancel',
  clients_editTitle: 'Edit client',
  clients_addTitle: 'Add client',
  clients_fieldName: 'Name',
  clients_fieldEmail: 'Email (optional)',
  clients_fieldPhone: 'Phone (optional)',
  clients_fieldNotes: 'Notes (optional)',
  clients_saving: 'Saving…',
  clients_save: 'Save',
  clients_cancel: 'Cancel',
  clients_saveFailed: 'Save failed',
  client_back: '← Back to clients',
  client_detailsTitle: 'Client details',
  client_notFound: 'Client not found.',
  client_noPhone: 'No phone provided',
  client_noEmail: 'No email provided',
  client_noNotes: 'No notes provided',
  client_appointmentHistory: 'Appointment History',
  client_updated: 'Last updated',
  client_financialSummary: 'Financial Summary',
  client_totalSpent: 'Total Spent',
  client_completed: 'Completed',
  client_avgPerAppointment: 'Avg / Appointment',
  client_upcoming: 'Upcoming',
  client_statusBreakdown: 'Appointment Status',

  common_cancel: 'Cancel',
  common_minutes: 'min',
  common_save: 'Save',
  common_loading: 'Loading…',
  common_error: 'An error occurred.',

  // Error codes
  error_unknown: 'An unexpected error occurred.',
  error_badRequest: 'Invalid request.',
  error_unauthorized: 'Authentication required.',
  error_forbidden: 'You do not have permission to perform this action.',
  error_notFound: 'The requested resource was not found.',
  error_validationError: 'Validation failed.',
  error_conflict: 'The request conflicts with the current state.',
  error_tooManyRequests: 'Too many requests. Please try again later.',
  error_internal: 'An internal server error occurred.',

  // Auth errors
  error_invalidCredentials: 'Invalid email or password.',
  error_wrongPassword: 'Current password is incorrect.',
  error_invalidRefreshToken: 'Invalid refresh token.',
  error_tokenReuseDetected: 'Refresh token reuse detected. All sessions have been revoked.',
  error_tokenExpired: 'Refresh token expired. Please sign in again.',
  error_userGone: 'Your account no longer exists.',
  error_noRefreshToken: 'No refresh token provided.',

  // Tenant errors
  error_invalidSubdomain: 'Subdomain contains invalid characters.',
  error_subdomainTooShort: 'Subdomain must be at least 3 characters.',
  error_subdomainTaken: 'This subdomain is already taken.',
  error_tenantInitFailed: 'Tenant initialization failed. Please try again.',
  error_alreadyActive: 'This item is already active.',
  error_alreadyInactive: 'This item is already inactive.',
  error_alreadySuspended: 'This tenant is already suspended.',
  error_tenantConcurrentUpdate: 'Tenant was updated by another request. Please try again.',

  // Staff errors
  error_staffNotFound: 'Staff member not found.',
  error_cannotChangeOwnRole: 'You cannot change your own role.',
  error_cannotDeactivateSelf: 'You cannot deactivate your own account.',
  error_emailTaken: 'This email is already in use.',
  error_alreadyDeleted: 'This item has already been deleted.',

  // Client errors
  error_clientNotFound: 'Client not found.',

  // Feature flag errors
  error_unknownFeatureKeys: 'Unknown feature key(s) specified.',

  // Zod validation errors
  error_tooShort: 'Value is too short.',
  error_tooLong: 'Value is too long.',
  error_tooSmall: 'Value is too small.',
  error_tooLarge: 'Value is too large.',
  error_invalidEmail: 'Invalid email address.',
  error_invalidUuid: 'Invalid UUID.',
  error_invalidString: 'Invalid string value.',
  error_invalidOption: 'Invalid option selected.',
  error_invalidType: 'Invalid type.',
  error_tooFewItems: 'Not enough items.',
  error_tooManyItems: 'Too many items.',

  // Scheduling page
  sched_title: 'Scheduling',
  sched_unavailable: 'Scheduling is not available for this tenant.',
  sched_tabAppointments: 'Appointments',
  sched_tabCalendar: 'Calendar',
  sched_tabResources: 'Resources',
  sched_tabServices: 'Services',
  sched_newAppointment: '+ New appointment',
  sched_add: 'Add',

  // Appointments tab
  appt_noAppointments: 'No appointments found.',
  appt_colStart: 'Start',
  appt_colEnd: 'End',
  appt_colDuration: 'Duration',
  appt_colResource: 'Resource',
  appt_colClient: 'Client',
  appt_colService: 'Service',
  appt_colStatus: 'Status',
  appt_colSummary: 'Summary',
  appt_colActions: 'Actions',
  appt_srOpenMenu: 'Open menu',
  appt_actionView: 'View',
  appt_actionCancel: 'Cancel',
  appt_actionCheckIn: 'Check in',
  appt_actionStart: 'Start',
  appt_actionComplete: 'Complete',
  appt_actionNoShow: 'No show',
  appt_actionReschedule: 'Reschedule',
  appt_actionChangeStatus: 'Change status',
  appt_filterSearch: 'Search',
  appt_filterSearchPlaceholder: 'Search...',
  appt_filterStatus: 'Status',
  appt_filterResource: 'Resource',
  appt_filterClient: 'Client',
  appt_filterFrom: 'From',
  appt_filterTo: 'To',
  appt_filterAll: 'All',
  appt_filterAllResources: 'All resources',
  appt_filterAllClients: 'All clients',
  appt_showingCount: 'Showing {count} appointment(s)',
  appt_showingOf: 'Showing {from}–{to} of {total}',
  appt_perPage: 'Per page',
  appt_errorLoad: 'Could not load appointments.',

  // Calendar tab
  cal_walkIn: 'Walk-in',
  cal_today: 'Today',
  cal_week: 'Week',
  cal_day: 'Day',
  cal_errorLoad: 'Could not load calendar data.',
  cal_dragError: 'Could not reschedule appointment.',

  // Resources tab
  res_addButton: '+ Add resource',
  res_errorLoad: 'Failed to load resources.',
  res_noResources: 'No resources.',
  res_colName: 'Name',
  res_colType: 'Type',
  res_colLinkedStaff: 'Linked staff',
  res_colStatus: 'Status',
  res_colActions: 'Actions',
  res_statusActive: 'Active',
  res_statusInactive: 'Inactive',
  res_actionEdit: 'Edit',
  res_actionSchedule: 'Schedule',
  res_actionDelete: 'Delete',
  res_deleteTitle: 'Delete resource',
  res_deleteBody: 'Are you sure you want to delete {name}? This action cannot be undone.',
  res_formEditTitle: 'Edit resource',
  res_formAddTitle: 'Add resource',
  res_formSaving: 'Saving…',
  res_formSaveChanges: 'Save changes',
  res_formAdd: 'Add resource',
  res_fieldName: 'Name',
  res_fieldType: 'Type',
  res_fieldLinkedStaff: 'Linked staff',
  res_fieldNotes: 'Notes',
  res_fieldActive: 'Active',
  res_typeProvider: 'Provider',
  res_typeRoom: 'Room',
  res_typeEquipment: 'Equipment',
  res_typeChair: 'Chair',
  res_selectStaffPlaceholder: 'Select staff member…',
  res_backToResources: '← Back to resources',
  res_workingHours: 'Working hours',
  res_timeOff: 'Time off',
  res_addBtn: 'Add',
  res_noWorkingHours: 'No working hours configured.',
  res_whColDay: 'Day',
  res_whColStartTime: 'Start time',
  res_whColEndTime: 'End time',
  res_whColValidFrom: 'Valid from',
  res_whColValidTo: 'Valid to',
  res_whOngoing: 'Ongoing',
  res_whEditTitle: 'Edit working hour',
  res_whAddTitle: 'Add working hour',
  res_whFieldDayOfWeek: 'Day of week',
  res_whFieldStartTime: 'Start time',
  res_whFieldEndTime: 'End time',
  res_whFieldValidFrom: 'Valid from',
  res_whFieldValidTo: 'Valid to',
  res_whDeleteTitle: 'Delete working hour',
  res_whDeleteBody: 'Are you sure you want to delete this working hour entry?',
  res_toAddTitle: 'Add time off',
  res_toColStart: 'Start',
  res_toColEnd: 'End',
  res_toColReason: 'Reason',
  res_toColActions: 'Actions',
  res_noTimeOff: 'No time off entries.',
  res_toFieldStart: 'Start',
  res_toFieldEnd: 'End',
  res_toFieldReason: 'Reason',
  res_toFieldReasonPlaceholder: 'Optional',
  res_toDeleteTitle: 'Delete time off',
  res_toDeleteBody: 'Are you sure you want to delete this time off entry?',

  // Services tab
  svc_addButton: '+ Add service',
  svc_noServices: 'No services yet.',
  svc_colName: 'Name',
  svc_colCategory: 'Category',
  svc_colDuration: 'Duration',
  svc_colBuffers: 'Buffers',
  svc_colPrice: 'Price',
  svc_colStatus: 'Status',
  svc_colActions: 'Actions',
  svc_statusActive: 'Active',
  svc_statusInactive: 'Inactive',
  svc_actionEdit: 'Edit',
  svc_actionRequirements: 'Requirements',
  svc_actionDelete: 'Delete',
  svc_durationMin: '{min} min',
  svc_bufferBeforeAfter: '{before} before / {after} after',
  svc_formEditTitle: 'Edit service',
  svc_formAddTitle: 'Add service',
  svc_fieldName: 'Name',
  svc_fieldDescription: 'Description',
  svc_fieldCategory: 'Category',
  svc_fieldCategoryPlaceholder: 'e.g. Consultation, Procedure',
  svc_fieldDuration: 'Duration (min)',
  svc_fieldBufferBefore: 'Buffer before (min)',
  svc_fieldBufferAfter: 'Buffer after (min)',
  svc_fieldPrice: 'Price (lei)',
  svc_fieldStatus: 'Status',
  svc_deleteTitle: 'Delete service',
  svc_deleteBody: 'Are you sure you want to delete {name}? This action cannot be undone.',
  svc_reqTitle: 'Resource requirements',
  svc_backToServices: '← Back to services',
  svc_reqSaved: 'Saved',
  svc_reqErrorSave: 'Failed to save requirements.',
  svc_reqErrorLoad: 'Failed to load requirements.',
  svc_reqNoRequirements: 'No resource requirements configured.',
  svc_reqColResourceType: 'Resource Type',
  svc_reqColQuantity: 'Quantity',
  svc_reqColRequired: 'Required',
  svc_reqAddButton: '+ Add requirement',
  svc_reqSaving: 'Saving…',
  svc_reqSaveButton: 'Save requirements',

  // Appointment detail
  apptDet_title: 'Appointment details',
  apptDet_unavailable: 'Appointments are not available for this tenant.',
  apptDet_errorLoad: 'Could not load appointment.',
  apptDet_backToAppointments: '← Back to appointments',
  apptDet_start: 'Start:',
  apptDet_end: 'End:',
  apptDet_duration: 'Duration:',
  apptDet_client: 'Client:',
  apptDet_walkIn: 'Walk-in',
  apptDet_summary: 'Summary:',
  apptDet_notes: 'Notes:',
  apptDet_cancellationReason: 'Cancellation reason:',
  apptDet_service: 'Service:',
  apptDet_resources: 'Resources:',
  apptDet_statusHistory: 'Status history',
  apptDet_created: 'Created',
  apptDet_cancelTitle: 'Cancel appointment',
  apptDet_cancelReasonLabel: 'Reason (optional)',
  apptDet_cancelButton: 'Cancel appointment',
  apptDet_rescheduleTitle: 'Reschedule appointment',
  apptDet_rescheduleFieldNewStart: 'New start time',
  apptDet_rescheduleFieldDuration: 'Duration (min)',
  apptDet_rescheduleFieldRequired: 'Start time is required',
  apptDet_rescheduleButton: 'Reschedule',
  apptDet_noteLabel: 'Note (optional)',
  apptDet_actionNoteTitle: '{action} appointment',
  apptDet_googleCalendar: 'Add to Google Calendar',

  // Create appointment form
  apptCreate_title: 'New appointment',
  apptCreate_clientLabel: 'Client (optional — leave empty for walk-in)',
  apptCreate_walkInOption: '— Walk-in —',
  apptCreate_providerLabel: 'Provider',
  apptCreate_roomLabel: 'Room (optional)',
  apptCreate_noRoom: '— No room —',
  apptCreate_resourceLabel: 'Resource',
  apptCreate_additionalResourcesLabel: 'Additional resources',
  apptCreate_serviceLabel: 'Service',
  apptCreate_durationLabel: 'Duration (minutes)',
  apptCreate_startAtLabel: 'Start at',
  apptCreate_summaryLabel: 'Summary (optional)',
  apptCreate_notesLabel: 'Notes (optional)',
  apptCreate_selectPlaceholder: '— Select —',
  apptCreate_creating: 'Creating…',
  apptCreate_create: 'Create',
  apptCreate_endPreview: 'Estimated end: {time} ({duration}m + {buffer}m before/after)',
  apptCreate_optionalDetails: 'Optional details',

  // Lifecycle helpers
  life_daySun: 'Sun',
  life_dayMon: 'Mon',
  life_dayTue: 'Tue',
  life_dayWed: 'Wed',
  life_dayThu: 'Thu',
  life_dayFri: 'Fri',
  life_daySat: 'Sat',
  life_typeProvider: 'Provider',
  life_typeRoom: 'Room',
  life_typeEquipment: 'Equipment',
  life_typeChair: 'Chair',
};

const ro: Translations = {
  nav_staff: 'Personal',
  nav_clients: 'Clienți',
  nav_calendar: 'Programări',
  nav_resources: 'Resurse',
  nav_services: 'Servicii',
  nav_profile: 'Profil',
  nav_signOut: 'Deconectare',
  nav_darkMode: 'Mod întunecat',
  nav_lightMode: 'Mod luminos',

  auth_signIn: 'Conectare',
  auth_signingIn: 'Se conectează…',
  auth_emailLabel: 'Email',
  auth_passwordLabel: 'Parolă',
  auth_serverError: 'Conectare eșuată. Verificați emailul și parola.',

  profile_title: 'Profil',
  profile_accountDetails: 'Detalii cont',
  profile_email: 'Adresă email',
  profile_role: 'Rol',
  profile_firstName: 'Prenume',
  profile_lastName: 'Nume',
  profile_preferences: 'Preferințe',
  profile_language: 'Limbă afișaj',
  profile_languageHint: 'Alegeți limba pentru interfața aplicației.',

  staff_title: 'Personal',
  staff_addButton: 'Adaugă personal',
  staff_description: 'Gestionați personalul din acest tenant. Resetarea parolei generează o parolă temporară pe care membrul trebuie să o schimbe la următoarea autentificare.',
  staff_errorLoad: 'Nu s-a putut încărca personalul.',
  staff_empty: 'Niciun angajat în acest tenant.',
  staff_colEmail: 'Email',
  staff_colName: 'Nume',
  staff_colRole: 'Rol',
  staff_colStatus: 'Stare',
  staff_colActions: 'Acțiuni',
  staff_tagYou: '(tu)',
  staff_statusActive: 'activ',
  staff_statusInactive: 'inactiv',
  staff_actionEdit: 'Editează',
  staff_actionResetPw: 'Resetare parolă',
  staff_actionDeactivate: 'Dezactivează',
  staff_actionActivate: 'Activează',
  staff_actionDelete: 'Șterge',
  staff_deleteTitle: 'Ștergeți angajatul?',
  staff_deleteBody: 'Aceasta va elimina definitiv pe {email} din acest tenant. Acesta nu se va mai putea conecta și toate sesiunile vor fi revocate.',
  staff_deleteBtn: 'Șterge',
  staff_deleteCancel: 'Anulează',
  staff_deleteDeleting: 'Se șterge…',

  staff_editTitle: 'Editare angajat',
  staff_editCannotChangeRole: 'Nu îți poți schimba propriul rol.',
  staff_editSaving: 'Se salvează…',
  staff_editSave: 'Salvează',
  staff_editCancelBtn: 'Anulează',
  staff_editSaveFailed: 'Salvare eșuată',

  staff_resetTitle: 'Resetare parolă?',
  staff_resetTitleDone: 'Parolă temporară',
  staff_resetBody: 'Aceasta va seta o nouă parolă temporară pentru {email}, îi va deconecta din toate sesiunile și va necesita alegerea unei noi parole la următoarea autentificare.',
  staff_resetTempPwBody: 'Parolă temporară pentru {email}. Transmiteți-o în siguranță — angajatul trebuie să o schimbe la următoarea autentificare.',
  staff_resetBtn: 'Resetează parola',
  staff_resetResetting: 'Se resetează…',
  staff_resetDone: 'Gata',
  staff_resetCopy: 'Copiază',
  staff_resetCancel: 'Anulează',

  staff_createTitle: 'Adaugă angajat',
  staff_createRoleNote: 'Noii angajați sunt creați ca tenant_user. Puteți schimba rolul după creare.',
  staff_createCreating: 'Se creează…',
  staff_createBtn: 'Creează',
  staff_createFailed: 'Creare eșuată',
  staff_createCancel: 'Anulează',

  clients_title: 'Clienți',
  clients_viewingTenant: 'Date pentru tenant-ul {subdomain}. Clienții fiecărui tenant se află într-o bază de date separată — această listă este izolată pentru acest tenant.',
  clients_description: 'Clienții fiecărui tenant se află într-o bază de date separată — această listă este izolată pentru acest tenant.',
  clients_addButton: 'Adaugă client',
  clients_errorLoad: 'Nu s-au putut încărca clienții.',
  clients_empty: 'Niciun client încă. Adăugați unul pentru a-l vedea izolat în acest tenant.',
  clients_colName: 'Nume',
  clients_colEmail: 'Email',
  clients_colPhone: 'Telefon',
  clients_colCreated: 'Creat',
  clients_colActions: 'Acțiuni',
  clients_actionEdit: 'Editează',
  clients_actionDelete: 'Șterge',
  clients_deleteTitle: 'Ștergeți clientul?',
  clients_deleteBody: 'Sigur doriți să ștergeți pe {name}? Acțiunea poate fi anulată de un administrator de bază de date.',
  clients_deleteBtn: 'Șterge',
  clients_deleteCancel: 'Anulează',
  clients_editTitle: 'Editare client',
  clients_addTitle: 'Adaugă client',
  clients_fieldName: 'Nume',
  clients_fieldEmail: 'Email (opțional)',
  clients_fieldPhone: 'Telefon (opțional)',
  clients_fieldNotes: 'Note (opțional)',
  clients_saving: 'Se salvează…',
  clients_save: 'Salvează',
  clients_cancel: 'Anulează',
  clients_saveFailed: 'Salvare eșuată',
  client_back: '← Înapoi la clienți',
  client_detailsTitle: 'Detalii client',
  client_notFound: 'Clientul nu a fost găsit.',
  client_noPhone: 'Niciun telefon furnizat',
  client_noEmail: 'Niciun email furnizat',
  client_noNotes: 'Nicio notă furnizată',
  client_appointmentHistory: 'Istoric programări',
  client_updated: 'Ultima actualizare',
  client_financialSummary: 'Sumar financiar',
  client_totalSpent: 'Total cheltuit',
  client_completed: 'Finalizate',
  client_avgPerAppointment: 'Media / programare',
  client_upcoming: 'Viitoare',
  client_statusBreakdown: 'Status programări',

  common_cancel: 'Anulează',
  common_minutes: 'min',
  common_save: 'Salvează',
  common_loading: 'Se încarcă…',
  common_error: 'A apărut o eroare.',

  // Error codes
  error_unknown: 'A apărut o eroare neașteptată.',
  error_badRequest: 'Cerere invalidă.',
  error_unauthorized: 'Autentificare necesară.',
  error_forbidden: 'Nu aveți permisiunea pentru această acțiune.',
  error_notFound: 'Resursa solicitată nu a fost găsită.',
  error_validationError: 'Validarea a eșuat.',
  error_conflict: 'Cererea este în conflict cu starea curentă.',
  error_tooManyRequests: 'Prea multe cereri. Încercați din nou mai târziu.',
  error_internal: 'A apărut o eroare internă pe server.',

  // Auth errors
  error_invalidCredentials: 'Email sau parolă invalidă.',
  error_wrongPassword: 'Parola curentă este incorectă.',
  error_invalidRefreshToken: 'Token de reîmprospătare invalid.',
  error_tokenReuseDetected: 'A fost detectată reutilizarea token-ului. Toate sesiunile au fost revocate.',
  error_tokenExpired: 'Token-ul de reîmprospătare a expirat. Reconectați-vă.',
  error_userGone: 'Contul dvs. nu mai există.',
  error_noRefreshToken: 'Nu a fost furnizat niciun token de reîmprospătare.',

  // Tenant errors
  error_invalidSubdomain: 'Subdomeniul conține caractere invalide.',
  error_subdomainTooShort: 'Subdomeniul trebuie să aibă cel puțin 3 caractere.',
  error_subdomainTaken: 'Acest subdomeniu este deja ocupat.',
  error_tenantInitFailed: 'Inițializarea tenant-ului a eșuat. Încercați din nou.',
  error_alreadyActive: 'Acest element este deja activ.',
  error_alreadyInactive: 'Acest element este deja inactiv.',
  error_alreadySuspended: 'Acest tenant este deja suspendat.',
  error_tenantConcurrentUpdate: 'Tenant-ul a fost actualizat de altă cerere. Încercați din nou.',

  // Staff errors
  error_staffNotFound: 'Membrul personalului nu a fost găsit.',
  error_cannotChangeOwnRole: 'Nu vă puteți schimba propriul rol.',
  error_cannotDeactivateSelf: 'Nu vă puteți dezactiva propriul cont.',
  error_emailTaken: 'Acest email este deja folosit.',
  error_alreadyDeleted: 'Acest element a fost deja șters.',

  // Client errors
  error_clientNotFound: 'Clientul nu a fost găsit.',

  // Feature flag errors
  error_unknownFeatureKeys: 'Cheie(e) de funcționalitate necunoscută(e) specificată(e).',

  // Zod validation errors
  error_tooShort: 'Valoarea este prea scurtă.',
  error_tooLong: 'Valoarea este prea lungă.',
  error_tooSmall: 'Valoarea este prea mică.',
  error_tooLarge: 'Valoarea este prea mare.',
  error_invalidEmail: 'Adresă email invalidă.',
  error_invalidUuid: 'UUID invalid.',
  error_invalidString: 'Valoare string invalidă.',
  error_invalidOption: 'Opțiune selectată invalidă.',
  error_invalidType: 'Tip invalid.',
  error_tooFewItems: 'Prea puține elemente.',
  error_tooManyItems: 'Prea multe elemente.',

  // Scheduling page
  sched_title: 'Programări',
  sched_unavailable: 'Programările nu sunt disponibile pentru acest tenant.',
  sched_tabAppointments: 'Programări',
  sched_tabCalendar: 'Calendar',
  sched_tabResources: 'Resurse',
  sched_tabServices: 'Servicii',
  sched_newAppointment: '+ Programare nouă',
  sched_add: 'Adaugă',

  // Appointments tab
  appt_noAppointments: 'Nicio programare găsită.',
  appt_colStart: 'Început',
  appt_colEnd: 'Sfârșit',
  appt_colDuration: 'Durată',
  appt_colResource: 'Resursă',
  appt_colClient: 'Client',
  appt_colService: 'Serviciu',
  appt_colStatus: 'Stare',
  appt_colSummary: 'Rezumat',
  appt_colActions: 'Acțiuni',
  appt_srOpenMenu: 'Deschide meniul',
  appt_actionView: 'Vizualizare',
  appt_actionCancel: 'Anulează',
  appt_actionCheckIn: 'Check-in',
  appt_actionStart: 'Începe',
  appt_actionComplete: 'Finalizează',
  appt_actionNoShow: 'Absent',
  appt_actionReschedule: 'Reprogramare',
  appt_actionChangeStatus: 'Schimbă statusul',
  appt_filterSearch: 'Căutare',
  appt_filterSearchPlaceholder: 'Caută...',
  appt_filterStatus: 'Stare',
  appt_filterResource: 'Resursă',
  appt_filterClient: 'Client',
  appt_filterFrom: 'De la',
  appt_filterTo: 'Până la',
  appt_filterAll: 'Toate',
  appt_filterAllResources: 'Toate resursele',
  appt_filterAllClients: 'Toți clienții',
  appt_showingCount: 'Se afișează {count} programare(i)',
  appt_showingOf: 'Se afișează {from}–{to} din {total}',
  appt_perPage: 'Pe pagină',
  appt_errorLoad: 'Nu s-au putut încărca programările.',

  // Calendar tab
  cal_walkIn: 'Fără programare',
  cal_today: 'Astăzi',
  cal_week: 'Săptămână',
  cal_day: 'Zi',
  cal_errorLoad: 'Nu s-au putut încărca datele calendarului.',
  cal_dragError: 'Nu s-a putut reprograma programarea.',

  // Resources tab
  res_addButton: '+ Adaugă resursă',
  res_errorLoad: 'Nu s-au putut încărca resursele.',
  res_noResources: 'Nicio resursă.',
  res_colName: 'Nume',
  res_colType: 'Tip',
  res_colLinkedStaff: 'Personal asociat',
  res_colStatus: 'Stare',
  res_colActions: 'Acțiuni',
  res_statusActive: 'Activă',
  res_statusInactive: 'Inactivă',
  res_actionEdit: 'Editează',
  res_actionSchedule: 'Program',
  res_actionDelete: 'Șterge',
  res_deleteTitle: 'Ștergeți resursa',
  res_deleteBody: 'Sigur doriți să ștergeți {name}? Această acțiune nu poate fi anulată.',
  res_formEditTitle: 'Editare resursă',
  res_formAddTitle: 'Adăugare resursă',
  res_formSaving: 'Se salvează…',
  res_formSaveChanges: 'Salvează modificările',
  res_formAdd: 'Adaugă resursă',
  res_fieldName: 'Nume',
  res_fieldType: 'Tip',
  res_fieldLinkedStaff: 'Personal asociat',
  res_fieldNotes: 'Note',
  res_fieldActive: 'Activă',
  res_typeProvider: 'Furnizor',
  res_typeRoom: 'Sală',
  res_typeEquipment: 'Echipament',
  res_typeChair: 'Scaun',
  res_selectStaffPlaceholder: 'Selectați membrul personalului…',
  res_backToResources: '← Înapoi la resurse',
  res_workingHours: 'Program de lucru',
  res_timeOff: 'Concediu',
  res_addBtn: 'Adaugă',
  res_noWorkingHours: 'Niciun program de lucru configurat.',
  res_whColDay: 'Zi',
  res_whColStartTime: 'Ora început',
  res_whColEndTime: 'Ora sfârșit',
  res_whColValidFrom: 'Valabil de la',
  res_whColValidTo: 'Valabil până la',
  res_whOngoing: 'Continuu',
  res_whEditTitle: 'Editare program de lucru',
  res_whAddTitle: 'Adăugare program de lucru',
  res_whFieldDayOfWeek: 'Zi din săptămână',
  res_whFieldStartTime: 'Ora început',
  res_whFieldEndTime: 'Ora sfârșit',
  res_whFieldValidFrom: 'Valabil de la',
  res_whFieldValidTo: 'Valabil până la',
  res_whDeleteTitle: 'Ștergeți programul de lucru',
  res_whDeleteBody: 'Sigur doriți să ștergeți această intrare de program de lucru?',
  res_toAddTitle: 'Adaugă concediu',
  res_toColStart: 'Început',
  res_toColEnd: 'Sfârșit',
  res_toColReason: 'Motiv',
  res_toColActions: 'Acțiuni',
  res_noTimeOff: 'Nicio intrare de concediu.',
  res_toFieldStart: 'Început',
  res_toFieldEnd: 'Sfârșit',
  res_toFieldReason: 'Motiv',
  res_toFieldReasonPlaceholder: 'Opțional',
  res_toDeleteTitle: 'Ștergeți concediul',
  res_toDeleteBody: 'Sigur doriți să ștergeți această intrare de concediu?',

  // Services tab
  svc_addButton: '+ Adaugă serviciu',
  svc_noServices: 'Niciun serviciu încă.',
  svc_colName: 'Nume',
  svc_colCategory: 'Categorie',
  svc_colDuration: 'Durată',
  svc_colBuffers: 'Tampon',
  svc_colPrice: 'Preț',
  svc_colStatus: 'Stare',
  svc_colActions: 'Acțiuni',
  svc_statusActive: 'Activ',
  svc_statusInactive: 'Inactiv',
  svc_actionEdit: 'Editează',
  svc_actionRequirements: 'Cerințe',
  svc_actionDelete: 'Șterge',
  svc_durationMin: '{min} min',
  svc_bufferBeforeAfter: '{before} înainte / {after} după',
  svc_formEditTitle: 'Editare serviciu',
  svc_formAddTitle: 'Adăugare serviciu',
  svc_fieldName: 'Nume',
  svc_fieldDescription: 'Descriere',
  svc_fieldCategory: 'Categorie',
  svc_fieldCategoryPlaceholder: 'ex. Consultație, Procedură',
  svc_fieldDuration: 'Durată (min)',
  svc_fieldBufferBefore: 'Tampon înainte (min)',
  svc_fieldBufferAfter: 'Tampon după (min)',
  svc_fieldPrice: 'Preț (lei)',
  svc_fieldStatus: 'Stare',
  svc_deleteTitle: 'Ștergeți serviciul',
  svc_deleteBody: 'Sigur doriți să ștergeți {name}? Această acțiune nu poate fi anulată.',
  svc_reqTitle: 'Cerințe de resurse',
  svc_backToServices: '← Înapoi la servicii',
  svc_reqSaved: 'Salvat',
  svc_reqErrorSave: 'Salvarea cerințelor a eșuat.',
  svc_reqErrorLoad: 'Încărcarea cerințelor a eșuat.',
  svc_reqNoRequirements: 'Nicio cerință de resurse configurată.',
  svc_reqColResourceType: 'Tip resursă',
  svc_reqColQuantity: 'Cantitate',
  svc_reqColRequired: 'Obligatoriu',
  svc_reqAddButton: '+ Adaugă cerință',
  svc_reqSaving: 'Se salvează…',
  svc_reqSaveButton: 'Salvează cerințele',

  // Appointment detail
  apptDet_title: 'Detalii programare',
  apptDet_unavailable: 'Programările nu sunt disponibile pentru acest tenant.',
  apptDet_errorLoad: 'Nu s-a putut încărca programarea.',
  apptDet_backToAppointments: '← Înapoi la programări',
  apptDet_start: 'Început:',
  apptDet_end: 'Sfârșit:',
  apptDet_duration: 'Durată:',
  apptDet_client: 'Client:',
  apptDet_walkIn: 'Fără programare',
  apptDet_summary: 'Rezumat:',
  apptDet_notes: 'Note:',
  apptDet_cancellationReason: 'Motiv anulare:',
  apptDet_service: 'Serviciu:',
  apptDet_resources: 'Resurse:',
  apptDet_statusHistory: 'Istoric stare',
  apptDet_created: 'Creată',
  apptDet_cancelTitle: 'Anulare programare',
  apptDet_cancelReasonLabel: 'Motiv (opțional)',
  apptDet_cancelButton: 'Anulează programarea',
  apptDet_rescheduleTitle: 'Reprogramare',
  apptDet_rescheduleFieldNewStart: 'Noua oră de început',
  apptDet_rescheduleFieldDuration: 'Durată (min)',
  apptDet_rescheduleFieldRequired: 'Ora de început este obligatorie',
  apptDet_rescheduleButton: 'Reprogramează',
  apptDet_noteLabel: 'Notă (opțional)',
  apptDet_actionNoteTitle: '{action} programare',
  apptDet_googleCalendar: 'Adaugă în Google Calendar',

  // Create appointment form
  apptCreate_title: 'Programare nouă',
  apptCreate_clientLabel: 'Client (opțional — lăsați gol pentru fără programare)',
  apptCreate_walkInOption: '— Fără programare —',
  apptCreate_providerLabel: 'Furnizor',
  apptCreate_roomLabel: 'Sală (opțional)',
  apptCreate_noRoom: '— Fără sală —',
  apptCreate_resourceLabel: 'Resursă',
  apptCreate_additionalResourcesLabel: 'Resurse suplimentare',
  apptCreate_serviceLabel: 'Serviciu',
  apptCreate_durationLabel: 'Durată (minute)',
  apptCreate_startAtLabel: 'Început la',
  apptCreate_summaryLabel: 'Rezumat (opțional)',
  apptCreate_notesLabel: 'Note (opțional)',
  apptCreate_selectPlaceholder: '— Selectați —',
  apptCreate_creating: 'Se creează…',
  apptCreate_create: 'Creează',
  apptCreate_endPreview: 'Sfârșit estimat: {time} ({duration}m + {buffer}m înainte/după)',
  apptCreate_optionalDetails: 'Detalii opționale',

  // Lifecycle helpers
  life_daySun: 'Dum',
  life_dayMon: 'Lun',
  life_dayTue: 'Mar',
  life_dayWed: 'Mie',
  life_dayThu: 'Joi',
  life_dayFri: 'Vin',
  life_daySat: 'Sâm',
  life_typeProvider: 'Furnizor',
  life_typeRoom: 'Sală',
  life_typeEquipment: 'Echipament',
  life_typeChair: 'Scaun',
};

export const translations: Record<Locale, Translations> = { en, ro };
