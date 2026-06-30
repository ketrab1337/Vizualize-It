import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Powiadomienia natywne Windows (Action Center) przez tauri-plugin-notification.
 *
 * Zasady:
 * - powiadamiamy TYLKO gdy okno aplikacji jest w tle (nie ma focusu) — przy
 *   aktywnym oknie użytkownik i tak widzi wynik, dymek byłby szumem,
 * - zgodę na powiadomienia prosimy leniwie przy pierwszym użyciu (standard Windows),
 * - wszystkie błędy są połykane: powiadomienie to dodatek, nie może wywrócić
 *   logiki batcha/nestingu.
 */
export async function notifyIfBackground(title: string, body: string): Promise<void> {
  try {
    // Gdy okno na wierzchu — nie zawracamy głowy dymkiem.
    if (await getCurrentWindow().isFocused()) return;

    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return;

    sendNotification({ title, body });
  } catch {
    // ignoruj — powiadomienie jest opcjonalne
  }
}
