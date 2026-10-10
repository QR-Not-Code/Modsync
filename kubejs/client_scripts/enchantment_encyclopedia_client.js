// Install in client_scripts. Rendering and ForgeEvents stay in startup_scripts.
(function(){
  NetworkEvents.dataReceived('kjs_encyclopedia_catalog_v1',function(event){
    try{
      var data=JSON.parse(String(event.getData().getString('payload'))),player=event.getPlayer();
      if(player==null||data.schema!==1||data.uuid!==String(player.getUuid())||!Array.isArray(data.entries))return;
      if(typeof global.kjsPmenuAcceptEnchantmentCatalogV1!=='function'){
        console.error('[encyclopedia packet] Startup renderer is not available.');
        return;
      }
      global.kjsPmenuAcceptEnchantmentCatalogV1(data);
    }catch(error){console.error('[encyclopedia packet] '+error);}
  });
})();
