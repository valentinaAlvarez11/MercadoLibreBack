const sqlite3 = require("sqlite3").verbose();

const dbUsuarios = new sqlite3.Database('./usuarios.db', (err) => {
  if (err) {
    console.error("Error al conectar con la base de datos de usuarios:", err.message);
    process.exit(1);
  } else {
    console.log("Conectado a la base de datos de usuarios");
  }
});

console.log("Iniciando migración de roles...");

// Actualizar todos los usuarios existentes para que tengan ambos roles activos
dbUsuarios.run(`
  UPDATE usuarios 
  SET rol_comprador = 1, rol_vendedor = 1 
  WHERE rol_comprador IS NULL OR rol_vendedor IS NULL
`, function(err) {
  if (err) {
    console.error("Error durante la migración:", err.message);
  } else {
    console.log(`Migración completada. ${this.changes} usuarios actualizados.`);
  }
  
  dbUsuarios.close((err) => {
    if (err) {
      console.error("Error al cerrar la base de datos:", err.message);
    } else {
      console.log("Migración finalizada exitosamente.");
    }
    process.exit(0);
  });
});


