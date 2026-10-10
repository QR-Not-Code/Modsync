// Only display strings in the server guide are normalized, never ItemStack NBT.
(function () {
  var map = {'，':', ','。':'. ','、':', ','：':': ','；':'; ','！':'! ','？':'? ',
    '“':'"','”':'"','‘':"'",'’':"'",'（':'(','）':')','【':'[','】':']','《':'"','》':'"',
    '「':'"','」':'"','『':'"','』':'"','〔':'[','〕':']','［':'[','］':']','｛':'{','｝':'}',
    '…':'...','—':' - ','–':'-','·':' - ','×':'*','÷':'/','≥':'>=','≤':'<=','→':'->','⇒':'=>',
    '−':'-','√':'sqrt','　':' ','①':'1. ','②':'2. ','③':'3. ','④':'4. ','⑤':'5. ',
    'Ⅰ':'I','Ⅱ':'II','Ⅲ':'III','Ⅳ':'IV','Ⅴ':'V','Ⅵ':'VI','Ⅶ':'VII','Ⅷ':'VIII','Ⅸ':'IX','Ⅹ':'X'};
  global.kjsGuidePunctuationV1 = function (value) {
    var text = String(value), out = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i), code = text.charCodeAt(i);
      out += map[ch] != null ? map[ch] : (code >= 0xff01 && code <= 0xff5e ? String.fromCharCode(code - 65248) : ch);
    }
    return out.replace(/ {2,}/g, ' ');
  };
})();
