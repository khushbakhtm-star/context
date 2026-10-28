package expo.modules.contextwear

import java.util.concurrent.Executors
import java.util.concurrent.locks.ReentrantLock
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.withLock

/** Serialize only identical DataItem paths, including any stale withdrawal.
 * Otherwise an old withdrawal could delete a newer authorized item at that URI. */
internal class WearPublicationLanes {
  private data class Slot(val lock: ReentrantLock = ReentrantLock(true), var users: Int = 0)
  private val paths = HashMap<String, Slot>()
  private val outgoing = ReentrantReadWriteLock(true)
  fun <T> withPath(path: String, work: () -> T): T = outgoing.readLock().withLock {
    val slot = synchronized(paths) {
      val current = paths[path] ?: run {
        check(paths.size < 256) { "Wear publication backpressure" }
        Slot().also { paths[path] = it }
      }
      current.users++
      current
    }
    try { slot.lock.withLock(work) }
    finally { synchronized(paths) { slot.users--; if (slot.users == 0) paths.remove(path) } }
  }
  // New authorized items wait until an older prefix withdrawal has completed.
  // This barrier never touches live inbox receipt or the local SQLite queue.
  fun <T> withdrawAll(work: () -> T): T = outgoing.writeLock().withLock(work)
}

/** Exactly one old-item scan and one live receiver may run at once. Admission
 * to the live lane is capped by WearBridge before a task is submitted. */
internal class WearWorkLanes : AutoCloseable {
  private val maintenance = Executors.newSingleThreadExecutor { work -> Thread(work, "ContextWearScan").apply { isDaemon = true } }
  private val live = Executors.newSingleThreadExecutor { work -> Thread(work, "ContextWearLiveInbox").apply { isDaemon = true } }
  fun maintain(work: () -> Unit) { maintenance.execute(work) }
  fun receive(work: () -> Unit) { live.execute(work) }
  override fun close() { maintenance.shutdownNow(); live.shutdownNow() }
}

/** A late SDK success must not publish private data after consent was withdrawn. */
internal fun <T> publishWithWearConsent(
  enabled: () -> Boolean,
  disabled: () -> Nothing,
  publish: () -> T,
  withdraw: (T) -> Unit
): T {
  if (!enabled()) disabled()
  val result = publish()
  if (!enabled()) {
    withdraw(result)
    disabled()
  }
  return result
}
