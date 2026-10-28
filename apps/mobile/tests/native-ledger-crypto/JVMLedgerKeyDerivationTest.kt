package expo.modules.contextledgercrypto

import java.security.Key
import java.security.Provider
import java.security.spec.KeySpec
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.SecretKeyFactorySpi
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.*
import org.junit.Test

class JVMLedgerKeyDerivationTest {
  private val salt = "000102030405060708090a0b0c0d0e0f"

  @Test fun productionUsesTheOriginalSixHundredThousandRoundKey() {
    val derivation = LedgerKeyDerivation()
    assertEquals("49e97ef2e63bdbdd95f0c5f37eacbd991de75f217994fa17d3ad2325123b2e81", derivation.deriveKeyHex("Context ledger test", salt))
    assertEquals("49e97ef2e63bdbdd95f0c5f37eacbd991de75f217994fa17d3ad2325123b2e81", derivation.deriveKeyHex("Context ledger test", salt.uppercase()))
  }

  @Test fun selfTestsUseSameFactoryThenClearEveryKeySpecBeforeTheResultReturns() {
    val spi = TrackingSpi()
    val derivation = LedgerKeyDerivation { TestFactory(spi) }
    val result = derivation.deriveKeyHex("Context ledger test", salt)
    assertEquals(64, result.length)
    assertEquals(List(9) { 17 } + listOf(600_000), spi.iterations)
    for (spec in spi.specs) {
      try { spec.password; fail("Provider key spec still exposes its password") } catch (_: IllegalStateException) { }
    }
    derivation.deriveKeyHex("Context ledger test", salt)
    assertEquals(11, spi.specs.size) // The tested factory is retained; self-tests are not repeated.
  }

  @Test fun incorrectProvidersFailBeforeARealKeyAndRemainFailed() {
    var factories = 0
    val spi = TrackingSpi(wrong = true)
    val derivation = LedgerKeyDerivation { factories += 1; TestFactory(spi) }
    repeat(2) {
      try { derivation.deriveKeyHex("Context ledger test", salt); fail("An incorrect provider was accepted") }
      catch (error: LedgerCryptoFailure) { assertEquals("ERR_LEDGER_CRYPTO_SELF_TEST", error.code) }
    }
    assertEquals(1, factories); assertEquals(listOf(17), spi.iterations)
  }

  @Test fun malformedOrUnpairedInputsNeverInstantiateAProvider() {
    var factories = 0
    val derivation = LedgerKeyDerivation { factories += 1; SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256") }
    for ((password, invalidSalt) in listOf("short" to salt, "x".repeat(1025) to salt,
      "Context \uD800 invalid" to salt, "Context \uDC00 invalid" to salt,
      "Context ledger test" to "ff".repeat(15), "Context ledger test" to "gg".repeat(16))) {
      try { derivation.deriveKeyHex(password, invalidSalt); fail("Invalid input was accepted") }
      catch (error: LedgerCryptoFailure) { assertEquals("ERR_LEDGER_CRYPTO_INPUT", error.code) }
    }
    assertEquals(0, factories)
  }

  private class TestFactory(spi: SecretKeyFactorySpi) : SecretKeyFactory(spi, object : Provider("TestLedgerProvider", "1.0", "Synthetic test provider") {}, "PBKDF2WithHmacSHA256")

  private class TrackingSpi(private val wrong: Boolean = false) : SecretKeyFactorySpi() {
    val specs = mutableListOf<PBEKeySpec>()
    val iterations = mutableListOf<Int>()
    private val delegate = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
    override fun engineGenerateSecret(spec: KeySpec): SecretKey {
      val pbe = spec as PBEKeySpec
      specs.add(pbe); iterations.add(pbe.iterationCount)
      return if (wrong) SecretKeySpec(ByteArray(32), "HmacSHA256") else delegate.generateSecret(spec)
    }
    override fun engineGetKeySpec(key: SecretKey, spec: Class<*>): KeySpec = throw UnsupportedOperationException()
    override fun engineTranslateKey(key: SecretKey): SecretKey = throw UnsupportedOperationException()
  }
}
