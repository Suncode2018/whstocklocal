const legacy=Object.freeze({"NameTH":"บริษัท รวยมั่งคั่ง 69 จำกัด","NameEN":"RUAYMANGKHANG 69 CO., LTD","AddressTH":"99/64 หมู่ที่ 5 ตำบลบางระกำ อำเภอบางเลน\nจังหวัดนครปฐม 73130","AddressEN":"99/64 Moo 5 Bang Rakam Subdistrict,\nBang Len District, Nakhon Pathom 73130","TaxId":"0735566010770","BranchCode":"00000","Phone":"084-556-1349","Email":"","LogoText":"69","LogoCaption":"RMK"});
function documentCompany(order){if(!order.CompanySnapshot)return legacy;const value=JSON.parse(order.CompanySnapshot);return {...legacy,...value};}
module.exports={legacy,documentCompany};
