/**
 * Pure policy for the SillyTavern extension gateway prototype.
 * No provider API calls, persistence, or Core contract are defined here.
 */

export async function interceptProtectedGeneration({
    pendingRequest,
    chat,
    contextSize,
    type,
    abort,
    dispatch,
}) {
    if (!pendingRequest) {
        return { status: 'PASS_THROUGH' };
    }

    // Abort first. Even a missing or failing callback must not fall back to
    // SillyTavern's native provider send for a protected request.
    abort(true);

    if (
        typeof pendingRequest.requestId !== 'string' ||
        pendingRequest.requestId.length === 0 ||
        typeof dispatch !== 'function'
    ) {
        return { status: 'BLOCKED_NO_TRUSTED_DISPATCH' };
    }

    try {
        await dispatch({
            requestId: pendingRequest.requestId,
            chat,
            contextSize,
            type,
        });
        return { status: 'DISPATCH_DELEGATED' };
    } catch {
        // Do not include exception text: it may contain prompt or provider data.
        return { status: 'BLOCKED_DISPATCH_FAILED' };
    }
}
