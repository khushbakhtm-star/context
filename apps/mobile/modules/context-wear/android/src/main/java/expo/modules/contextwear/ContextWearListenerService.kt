package expo.modules.contextwear

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.WearableListenerService

class ContextWearListenerService : WearableListenerService() {
  override fun onDataChanged(events: DataEventBuffer) {
    for (event in events) {
      if (event.type == DataEvent.TYPE_CHANGED) {
        // Extract Asset metadata while this buffer is valid. The process-owned
        // receiver keeps its work if Play Services unbinds this listener service.
        WearBridge.enqueue(applicationContext, event.dataItem)
      }
    }
  }
}
