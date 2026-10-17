export function useAdminTools() {
  const { t, tr } = useLoopI18n();
  function errorMessage(error: unknown) {
    const failure = error as { data?: { statusMessage?: string }; statusCode?: number };
    return failure.data?.statusMessage ? tr(failure.data.statusMessage) : t("admin.requestError");
  }
  return { errorMessage };
}
