/**
 * GOOGLE APPS SCRIPT: SINKRONISASI GOOGLE SHEETS & GOOGLE DRIVE
 * Folder Penyimpanan: DATABASE PDF SURETY BOND
 * ID Folder: 1asIe62GFX6b7SWjaXDcGx--2_l1-dJOg
 */

var FOLDER_ID = "1asIe62GFX6b7SWjaXDcGx--2_l1-dJOg";

// Fungsi untuk cek & aktivasi izin Drive (Cukup klik 'Run'/'Jalankan' sekali di editor)
function testDrivePermission() {
  var folder = DriveApp.getFolderById(FOLDER_ID);
  Logger.log("BERHASIL! Folder Drive terhubung: " + folder.getName());
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "ok",
    service: "Surety Bond Sheets & Drive Webhook",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "No post data" })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = JSON.parse(e.postData.contents);
    var action = data.action || "INSERT";
    var sheetName = data.sheet_name || (data.env === "testing" ? "TESTING" : "REGISTER SURETY BOND");
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow([
        "NO. POLIS", "JENIS BOND", "PRINCIPAL (TERJAMIN)", "OBLIGEE (PENERIMA)",
        "NAMA PEKERJAAN / PROYEK", "NILAI BOND", "TGL TERBIT", "TGL AWAL",
        "TGL AKHIR", "JUMLAH HK", "Dibuat", "LINK PDF ASLI"
      ]);
    }

    var fileUrl = data.file_url || "";
    var fileError = "";

    // 1. Simpan file PDF ke Google Drive jika ada file_base64
    if (data.file_base64) {
      try {
        var folder = DriveApp.getFolderById(FOLDER_ID);
        var decodedBytes = Utilities.base64Decode(data.file_base64);
        var fileName = data.file_name || "Dokumen_Jaminan.pdf";
        var blob = Utilities.newBlob(decodedBytes, data.file_mime || "application/pdf", fileName);
        
        var driveFile = folder.createFile(blob);
        fileUrl = driveFile.getUrl();

        // Coba set sharing publik jika diperbolehkan akun
        try {
          driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (shareErr) {
          // Akun Google Workspace mungkin membatasi public sharing
        }
      } catch (fileErr) {
        fileError = fileErr.toString();
        console.error("Gagal membuat file di Google Drive:", fileErr);
      }
    }

    // 2. Eksekusi Aksi (INSERT, UPDATE, DELETE)
    if (action === "INSERT") {
      var linkCell = fileUrl ? '=HYPERLINK("' + fileUrl + '", "Buka PDF")' : "-";
      
      var newRow = [
        data.nomor_identitas || data.no_polis || "-",
        data.kode_jenis || data.jenis_bond || "PB",
        data.nama_klien || data.principal || "-",
        data.obligee || "-",
        data.pekerjaan || "-",
        data.nilai_proyek || data.nilai_bond || "-",
        data.tgl_terbit || "-",
        data.tgl_awal || "-",
        data.tgl_akhir || "-",
        data.durasi_hk || "-",
        data.waktu_input || Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss"),
        linkCell
      ];

      sheet.appendRow(newRow);

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        action: "INSERT",
        file_url: fileUrl,
        file_error: fileError
      })).setMimeType(ContentService.MimeType.JSON);

    } else if (action === "UPDATE") {
      var rows = sheet.getDataRange().getValues();
      var targetNoPolis = (data.nomor_identitas || data.no_polis || "").toString().trim().toLowerCase();
      var updated = false;

      for (var i = 1; i < rows.length; i++) {
        var rowPolis = (rows[i][0] || "").toString().trim().toLowerCase();
        if (rowPolis === targetNoPolis) {
          var rowIndex = i + 1;
          sheet.getRange(rowIndex, 1).setValue(data.nomor_identitas || data.no_polis || "-");
          sheet.getRange(rowIndex, 2).setValue(data.kode_jenis || data.jenis_bond || "PB");
          sheet.getRange(rowIndex, 3).setValue(data.nama_klien || data.principal || "-");
          sheet.getRange(rowIndex, 4).setValue(data.obligee || "-");
          sheet.getRange(rowIndex, 5).setValue(data.pekerjaan || "-");
          sheet.getRange(rowIndex, 6).setValue(data.nilai_proyek || data.nilai_bond || "-");
          sheet.getRange(rowIndex, 7).setValue(data.tgl_terbit || "-");
          sheet.getRange(rowIndex, 8).setValue(data.tgl_awal || "-");
          sheet.getRange(rowIndex, 9).setValue(data.tgl_akhir || "-");
          sheet.getRange(rowIndex, 10).setValue(data.durasi_hk || "-");
          sheet.getRange(rowIndex, 11).setValue(data.waktu_input || Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss"));
          if (fileUrl) {
            sheet.getRange(rowIndex, 12).setValue('=HYPERLINK("' + fileUrl + '", "Buka PDF")');
          }
          updated = true;
          break;
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        action: "UPDATE",
        updated: updated,
        file_url: fileUrl,
        file_error: fileError
      })).setMimeType(ContentService.MimeType.JSON);

    } else if (action === "DELETE") {
      var rows = sheet.getDataRange().getValues();
      var targetNoPolis = (data.nomor_identitas || data.no_polis || "").toString().trim().toLowerCase();
      var deleted = false;

      for (var i = 1; i < rows.length; i++) {
        var rowPolis = (rows[i][0] || "").toString().trim().toLowerCase();
        if (rowPolis === targetNoPolis) {
          sheet.deleteRow(i + 1);
          deleted = true;
          break;
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        action: "DELETE",
        deleted: deleted
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "Unknown action"
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
