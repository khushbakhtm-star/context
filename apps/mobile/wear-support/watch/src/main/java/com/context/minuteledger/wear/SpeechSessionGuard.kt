package com.context.minuteledger.wear

import java.util.UUID

/** Identity of one system recognizer invocation, retained through recreation. */
data class SpeechSession(val requestCode: Int, val editorSessionId: String, val coordinate: Coordinate,
    val operationId: String = UUID.randomUUID().toString()) {
    init {
        require(requestCode in 0..65535)
        require(editorSessionId.isNotBlank())
        require(operationId.isNotBlank())
    }
}

object SpeechSessionGuard {
    /** Test the immutable editor session even while its view is still restoring.
     * Clearing pending on Cancel invalidates every later callback from that request. */
    fun accepts(pending: SpeechSession?, requestCode: Int, editor: EditorSession?): Boolean =
        pending != null && editor != null && pending.requestCode == requestCode &&
            pending.editorSessionId == editor.sessionId && pending.coordinate == editor.coordinate
}
