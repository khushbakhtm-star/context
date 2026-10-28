package expo.modules.contextledgercrypto

import java.security.MessageDigest
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

internal class LedgerCryptoFailure(val code: String) : Exception("Ledger key derivation could not complete.")

/** No Android dependency: the same JCA path can be exercised by host compatibility tests. */
internal class LedgerKeyDerivation(
  private val makeFactory: () -> SecretKeyFactory = { SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256") },
) {
  private var verifiedFactory: SecretKeyFactory? = null
  private var verificationFailed = false

  @Synchronized
  fun deriveKeyHex(passphrase: String, saltHex: String): String {
    if (passphrase.length !in 12..1024 || !isWellFormedUtf16(passphrase) || !SALT_HEX.matches(saltHex)) {
      throw LedgerCryptoFailure("ERR_LEDGER_CRYPTO_INPUT")
    }
    val salt = fromHex(saltHex)
    var result: ByteArray? = null
    try {
      result = deriveBytes(verifiedProvider(), passphrase, salt, ITERATIONS)
      if (result.size != KEY_BYTES) throw LedgerCryptoFailure("ERR_LEDGER_CRYPTO_RESULT")
      return toHex(result)
    } catch (failure: LedgerCryptoFailure) {
      throw failure
    } catch (_: Exception) {
      throw LedgerCryptoFailure("ERR_LEDGER_CRYPTO_DERIVE")
    } finally {
      salt.fill(0)
      result?.fill(0)
    }
  }

  private fun verifiedProvider(): SecretKeyFactory {
    verifiedFactory?.let { return it }
    if (verificationFailed) throw LedgerCryptoFailure("ERR_LEDGER_CRYPTO_SELF_TEST")
    try {
      val factory = makeFactory()
      for (vector in VECTORS) {
        val salt = fromHex(vector.salt)
        val expected = fromHex(vector.key)
        var actual: ByteArray? = null
        try {
          actual = deriveBytes(factory, vector.password, salt, SELF_TEST_ITERATIONS)
          if (!MessageDigest.isEqual(expected, actual)) throw LedgerCryptoFailure("ERR_LEDGER_CRYPTO_SELF_TEST")
        } finally {
          salt.fill(0)
          expected.fill(0)
          actual?.fill(0)
        }
      }
      verifiedFactory = factory
      return factory
    } catch (_: Exception) {
      verificationFailed = true
      throw LedgerCryptoFailure("ERR_LEDGER_CRYPTO_SELF_TEST")
    }
  }

  private fun deriveBytes(factory: SecretKeyFactory, password: String, salt: ByteArray, iterations: Int): ByteArray {
    val chars = password.toCharArray()
    var spec: PBEKeySpec? = null
    try {
      spec = PBEKeySpec(chars, salt, iterations, KEY_BYTES * 8)
      return factory.generateSecret(spec).encoded
    } finally {
      spec?.clearPassword()
      chars.fill('\u0000')
    }
  }

  private data class Vector(val password: String, val salt: String, val key: String)

  companion object {
    const val ITERATIONS = 600_000
    const val KEY_BYTES = 32
    private const val SELF_TEST_ITERATIONS = 17
    private const val SALT = "000102030405060708090a0b0c0d0e0f"
    private const val HIGH_SALT = "ffeeddccbbaa99887766554433221100"
    private val SALT_HEX = Regex("[0-9a-fA-F]{32}")
    // Independently matched against the existing Noble implementation and Node PBKDF2.
    private val VECTORS = listOf(
      Vector("Context ledger test", SALT, "2044bde80ca87cdef3b627db67905a5806e93f1631f3e6272080cf9e17a48b15"),
      Vector("Ledger \u0645\u0631\u062d\u0628\u0627 passphrase", SALT, "5758b679c3471d2164019506381de351bd0773d63bfa3b2a48e17828032a1d48"),
      Vector("Ledger \ud83d\udcda \ud83e\uddd1\u200d\ud83d\udcbb passphrase", SALT, "10679f2114a05660d9d9e998effe43e3f89666a87b33d0714509d5f3ad5ec3b8"),
      Vector("Cafe\u0301 ledger passphrase", SALT, "705df4318931ba5767e86d9af6bf423676bf704a6d654e8b7e9128dbea3bef14"),
      Vector("Caf\u00e9 ledger passphrase", SALT, "9e7e3e2e3d74f136a2154ee7c6828a12789eae6c92bcce687cc8b30ad8c86264"),
      Vector("Context\u0000ledger passphrase", SALT, "036317d67ad6dac569b0b4a699959bce14761d84e2c3547467fb4d3bcf2358a6"),
      Vector("x".repeat(64), HIGH_SALT, "2d7e1920017a39d3637e5ad8f91f6d98e2d43c9c176b2c6bd1a84b2c1c2756f8"),
      Vector("x".repeat(65), HIGH_SALT, "cf243f44a8c67c69d452ee1c5177dbbc27ec5d740555b8bd266897907bd72fd7"),
      Vector("x".repeat(1024), HIGH_SALT, "c9dc0d2a31bc0f3cbe17a25810284ff575d6e067c9bb5722f877dc7e0ee883c9"),
    )

    private fun isWellFormedUtf16(value: String): Boolean {
      var index = 0
      while (index < value.length) {
        val code = value[index].code
        if (code in 0xD800..0xDBFF) {
          if (index + 1 >= value.length || value[index + 1].code !in 0xDC00..0xDFFF) return false
          index += 2
        } else {
          if (code in 0xDC00..0xDFFF) return false
          index += 1
        }
      }
      return true
    }

    private fun fromHex(value: String): ByteArray = ByteArray(value.length / 2) { index ->
      value.substring(index * 2, index * 2 + 2).toInt(16).toByte()
    }

    private fun toHex(bytes: ByteArray): String {
      val chars = CharArray(bytes.size * 2)
      try {
        val digits = "0123456789abcdef"
        bytes.forEachIndexed { index, byte ->
          val value = byte.toInt() and 0xff
          chars[index * 2] = digits[value ushr 4]
          chars[index * 2 + 1] = digits[value and 0xf]
        }
        return String(chars)
      } finally {
        chars.fill('\u0000')
      }
    }
  }
}
