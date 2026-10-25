package expo.modules.contextwear

import android.content.Context
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID

class ContextWearModule : Module() {
  private val observerId = UUID.randomUUID().toString()
  private val main = Handler(Looper.getMainLooper())

  private fun context(): Context = appContext.reactContext?.applicationContext
    ?: throw WearBridgeFailure("ERR_WEAR_CONTEXT_UNAVAILABLE")

  private suspend fun <T> guarded(work: () -> T): T = withContext(Dispatchers.IO) {
    try { work() }
    catch (error: WearBridgeFailure) { throw CodedException(error.code, "The watch connection could not complete this operation.", null) }
    catch (_: LinkageError) { throw CodedException("ERR_WEAR_UNAVAILABLE", "The watch connection is unavailable.", null) }
    catch (_: Exception) { throw CodedException("ERR_WEAR_IO", "The watch connection could not complete this operation.", null) }
  }

  override fun definition() = ModuleDefinition {
    Name("ContextWear")
    Events("onInboxChanged")

    OnCreate {
      WearBridge.addObserver(observerId) { count -> main.post {
        try { sendEvent("onInboxChanged", mapOf("pendingCount" to count)) } catch (_: Exception) { }
      } }
    }
    OnDestroy { WearBridge.removeObserver(observerId) }

    AsyncFunction("setEnabledAsync") Coroutine { enabled: Boolean ->
      guarded { WearBridge.setEnabled(context(), enabled) }
    }
    AsyncFunction("scanPendingAsync") Coroutine { guarded { WearBridge.scanPending(context()) } }
    AsyncFunction("drainInboxAsync") Coroutine { guarded {
      val application = context()
      if (WearInbox.enabled(application)) WearInbox.drain(application).map { it.publicValue() } else emptyList()
    } }
    AsyncFunction("acknowledgeInboxAsync") Coroutine { id: String -> guarded { WearBridge.acknowledge(context(), id) } }
    AsyncFunction("publishDayAsync") Coroutine { json: String -> guarded { WearBridge.publishDay(context(), json) } }
    AsyncFunction("publishAckAsync") Coroutine { json: String -> guarded { WearBridge.publishAck(context(), json) } }
    AsyncFunction("getStatusAsync") Coroutine {
      withContext(Dispatchers.IO) {
        try { WearBridge.status(context()) }
        catch (_: Throwable) { mapOf("enabled" to false, "connectedNodeCount" to 0,
          "pendingCount" to 0, "error" to "ERR_WEAR_UNAVAILABLE") }
      }
    }
  }
}
