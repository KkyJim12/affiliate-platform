let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function useAppUI() {
  const toast = useState("app-toast", () => "");
  const authOpen = useState("auth-open", () => false);
  function notify(message: string) {
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.value = "";
    }, 4000);
  }
  async function copy(text: string, message = "Copied to clipboard") {
    try {
      await navigator.clipboard.writeText(text);
      notify(message);
    } catch {
      notify("Clipboard unavailable. You can select and copy the text.");
    }
  }
  return { toast, authOpen, notify, copy };
}
