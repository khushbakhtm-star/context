package expo.modules.contextledgercrypto

import android.os.Build
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.ensureActive

class ContextLedgerCryptoModule : Module() {
  private val dispatcher = Executors.newSingleThreadExecutor { task ->
    Thread(task, "ContextLedgerCrypto").apply { isDaemon = true }
  }.asCoroutineDispatcher()
  private val workScope = CoroutineScope(SupervisorJob() + dispatcher)
  private val derivation = LedgerKeyDerivation()

  override fun definition() = ModuleDefinition {
    Name("ContextLedgerCrypto")
    // PBKDF2 never occupies Expo's shared DEFAULT queue or the Android/JS UI thread.
    AsyncFunction("deriveKeyAsync") { passphrase: String, saltHex: String ->
      if (Build.VERSION.SDK_INT < 26) return@AsyncFunction null
      workScope.ensureActive()
      try {
        val key = derivation.deriveKeyHex(passphrase, saltHex)
        workScope.ensureActive()
        key
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (failure: LedgerCryptoFailure) {
        throw CodedException(failure.code, "The phone could not verify its ledger key derivation.", null)
      } catch (_: Exception) {
        throw CodedException("ERR_LEDGER_CRYPTO_DERIVE", "The phone could not derive its ledger key.", null)
      }
    }.runOnQueue(workScope)
    OnDestroy {
      workScope.cancel()
      dispatcher.close()
    }
  }
}
