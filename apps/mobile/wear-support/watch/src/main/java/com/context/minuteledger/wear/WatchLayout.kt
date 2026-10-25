package com.context.minuteledger.wear

/** Keep the primary ledger usable on 198 dp round watches; the IME may resize dialogs. */
object WatchLayout {
    const val TOP = 20
    const val HEADER = 30
    const val STATUS = 16
    const val MINUTE = 52
    const val EDITOR_BOTTOM = 22
    const val ACTIONS = 32
    const val TITLE = 18
    const val TEXT_FIELD = 70
    const val INPUT_TOOLS = 32
    fun ledgerViewport(height: Int) = height - TOP - HEADER - STATUS
    fun editorViewport(height: Int) = height - TOP - EDITOR_BOTTOM - ACTIONS
    fun editorBodyHeight() = TITLE + TEXT_FIELD + INPUT_TOOLS
}
