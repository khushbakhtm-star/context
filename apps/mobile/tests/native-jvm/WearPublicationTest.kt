package expo.modules.contextwear

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class WearPublicationTest {
  @Test fun heldScanDoesNotDelayANewLiveDataEvent() {
    val lanes = WearWorkLanes()
    val scanStarted = CountDownLatch(1)
    val releaseScan = CountDownLatch(1)
    val received = CountDownLatch(1)
    try {
      lanes.maintain { scanStarted.countDown(); releaseScan.await() }
      assertTrue(scanStarted.await(2, TimeUnit.SECONDS))
      lanes.receive { received.countDown() }
      assertTrue("live inbox work must not wait for the old Asset scan", received.await(2, TimeUnit.SECONDS))
      assertEquals(1L, releaseScan.count)
    } finally { releaseScan.countDown(); lanes.close() }
  }

  @Test fun liveReceiversRemainSerialized() {
    val lanes = WearWorkLanes()
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val second = CountDownLatch(1)
    try {
      lanes.receive { entered.countDown(); release.await() }
      assertTrue(entered.await(2, TimeUnit.SECONDS))
      lanes.receive { second.countDown() }
      assertFalse(second.await(40, TimeUnit.MILLISECONDS))
      release.countDown()
      assertTrue(second.await(2, TimeUnit.SECONDS))
    } finally { release.countDown(); lanes.close() }
  }

  @Test fun revocationDuringPublicationWithdrawsTheExactCreatedItemBeforeFailure() {
    val enabled = AtomicBoolean(true)
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val withdrawn = AtomicReference<String>()
    val failure = AtomicReference<Throwable>()
    val succeeded = AtomicBoolean(false)
    val thread = Thread {
      try {
        publishWithWearConsent(
          enabled = { enabled.get() }, disabled = { throw IllegalStateException("disabled") },
          publish = { started.countDown(); release.await(); "wear://local/ack/exact-operation" },
          withdraw = { withdrawn.set(it) }
        )
        succeeded.set(true)
      } catch (error: Throwable) { failure.set(error) }
    }
    thread.start()
    try {
      assertTrue(started.await(2, TimeUnit.SECONDS)); enabled.set(false); release.countDown(); thread.join(2000)
      assertFalse(thread.isAlive)
      assertEquals("wear://local/ack/exact-operation", withdrawn.get())
      assertEquals("disabled", failure.get()?.message); assertFalse(succeeded.get())
    } finally { release.countDown(); thread.join(2000) }
  }

  @Test fun disabledPublicationNeverCallsTheSdk() {
    var published = false
    assertThrows(IllegalStateException::class.java) {
      publishWithWearConsent(enabled = { false }, disabled = { throw IllegalStateException("disabled") },
        publish = { published = true; "item" }, withdraw = { fail("No item exists to withdraw") })
    }
    assertFalse(published)
  }

  @Test fun revokeAndReenableCannotAuthorizeAnOlderInFlightPublication() {
    var epoch = 4
    val captured = epoch
    var withdrawn = false
    assertThrows(IllegalStateException::class.java) {
      publishWithWearConsent<String>(enabled = { epoch == captured }, disabled = { throw IllegalStateException("stale consent") },
        publish = { epoch += 2; "old item" }, withdraw = { assertEquals("old item", it); withdrawn = true })
    }
    assertTrue(withdrawn)
  }

  @Test fun authorizedPublicationReturnsItsActualAcknowledgement() {
    val actual = Any()
    assertSame(actual, publishWithWearConsent(enabled = { true }, disabled = { error("disabled") },
      publish = { actual }, withdraw = { fail("Consent stayed enabled") }))
  }

  @Test fun staleWithdrawalFinishesBeforeANewerSamePathPublicationButNotOtherPaths() {
    val paths = WearPublicationLanes()
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val samePath = CountDownLatch(1)
    val otherPath = CountDownLatch(1)
    val item = AtomicReference("old")
    val old = Thread { paths.withPath("/ack/exact") {
      entered.countDown(); release.await(); item.set("withdrawn")
    } }
    val fresh = Thread { paths.withPath("/ack/exact") { item.set("new"); samePath.countDown() } }
    val independent = Thread { paths.withPath("/day/other") { otherPath.countDown() } }
    old.start()
    try {
      assertTrue(entered.await(2, TimeUnit.SECONDS)); fresh.start(); independent.start()
      assertTrue(otherPath.await(2, TimeUnit.SECONDS))
      assertFalse(samePath.await(40, TimeUnit.MILLISECONDS))
      release.countDown(); old.join(2000); fresh.join(2000); independent.join(2000)
      assertEquals("new", item.get()); assertEquals(0L, samePath.count)
    } finally { release.countDown(); old.join(2000); fresh.join(2000); independent.join(2000) }
  }

  @Test fun anOlderPrefixWithdrawalCannotDeleteANewerAuthorizedPublication() {
    val paths = WearPublicationLanes()
    val deleting = CountDownLatch(1)
    val release = CountDownLatch(1)
    val published = CountDownLatch(1)
    val item = AtomicReference("old")
    val revoke = Thread { paths.withdrawAll { deleting.countDown(); release.await(); item.set("removed prefix") } }
    val reenabled = Thread { paths.withPath("/ack/new-session") { item.set("new authorized item"); published.countDown() } }
    revoke.start()
    try {
      assertTrue(deleting.await(2, TimeUnit.SECONDS)); reenabled.start()
      assertFalse(published.await(40, TimeUnit.MILLISECONDS))
      release.countDown(); revoke.join(2000); reenabled.join(2000)
      assertEquals("new authorized item", item.get()); assertEquals(0L, published.count)
    } finally { release.countDown(); revoke.join(2000); reenabled.join(2000) }
  }
}
