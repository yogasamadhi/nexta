export type NativeCalendarPermissionResponse = Readonly<{
  status: string;
  granted: boolean;
  canAskAgain: boolean;
}>;

export type NativeCalendarSource = Readonly<{
  id?: string;
  name: string;
  type: string;
  isLocalAccount?: boolean;
}>;

export type NativeCalendar = Readonly<{
  id: string;
  title: string;
  allowsModifications: boolean;
  source?: NativeCalendarSource;
  color?: string;
  isPrimary?: boolean;
  isVisible?: boolean;
  isSynced?: boolean;
}>;

export type NativeCalendarEvent = Readonly<{
  id: string;
  calendarId: string;
  title: string;
  startDate: Date | string | number;
  endDate: Date | string | number;
  notes?: string | null;
  availability?: string | null;
  status?: string | null;
  originalId?: string | null;
  instanceId?: string | null;
  originalStartDate?: Date | string | number | null;
  allDay?: boolean;
}>;

export type NativeCalendarListEventsResult = Readonly<{
  completeness: 'complete' | 'partial';
  events: readonly NativeCalendarEvent[];
}>;

export type NativeCreateCalendarInput = Readonly<{
  title: string;
  color?: string;
  sourceId?: string;
  source?: NativeCalendarSource;
  name?: string;
  ownerAccount?: string;
  isVisible?: boolean;
  isSynced?: boolean;
  timeZone?: string;
}>;

export type NativeCalendarEventInput = Readonly<{
  title: string;
  startDate: Date;
  endDate: Date;
  notes: string;
}>;

export type NativeCalendarEventPatch = Readonly<{
  title?: string;
  startDate?: Date;
  endDate?: Date;
  notes?: string;
}>;

/**
 * Structural boundary around expo-calendar. Tests inject this interface so
 * importing and exercising the adapter never initializes a native module.
 */
export interface NativeCalendarFacade {
  getPermissionState(): Promise<NativeCalendarPermissionResponse>;
  requestPermission(): Promise<NativeCalendarPermissionResponse>;
  listCalendars(): Promise<readonly NativeCalendar[]>;
  createCalendar(input: NativeCreateCalendarInput): Promise<NativeCalendar>;
  listEvents(
    calendarIds: readonly string[],
    start: Date,
    end: Date,
  ): Promise<NativeCalendarListEventsResult>;
  createEvent(
    calendarId: string,
    input: NativeCalendarEventInput,
  ): Promise<NativeCalendarEvent>;
  updateEvent(eventId: string, patch: NativeCalendarEventPatch): Promise<void>;
  deleteEvent(eventId: string): Promise<void>;
}
