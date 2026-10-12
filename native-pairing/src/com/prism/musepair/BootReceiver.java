package com.prism.musepair;
import android.content.*;
public class BootReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context c,Intent i){if(Intent.ACTION_BOOT_COMPLETED.equals(i.getAction())&&new java.io.File(c.getFilesDir(),"muse-pairing.enc").exists())c.startForegroundService(new Intent(c,MuseService.class));}
}
