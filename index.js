const express = require("express");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const sqlite3 = require("sqlite3").verbose();

const cors = require("cors");
const app = express();
const PORT = 3000;
const SECRET_KEY = "tu_clave_secreta_aqui";

// Conexión y tabla para usuarios
const dbUsuarios = new sqlite3.Database('./usuarios.db', (err) => {
  if (err) {
    console.error("Error al conectar con la base de datos de usuarios:", err.message);
  } else {
    console.log("Conectado a la base de datos de usuarios");
  }
});
dbUsuarios.run(`CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  telefono TEXT,
  nombre TEXT,
  contraseña TEXT
)`);

// Conexión y tabla para productos
const dbProductos = new sqlite3.Database('./product.db', (err) => {
  if (err) {
    console.error("Error al conectar con la base de datos de productos:", err.message);
  } else {
    console.log("Conectado a la base de datos de productos");
  }
});
dbProductos.run(`CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price TEXT NOT NULL,
  rating REAL NOT NULL,
  description TEXT NOT NULL,
  imageUrl TEXT NOT NULL
)`);


// Middleware para CORS (permitir peticiones del frontend)
app.use(cors({
  origin: "http://localhost:3001", // Cambia el puerto si tu frontend corre en otro
  credentials: true
}));
// Middleware para procesar JSON y cookies
app.use(express.json());
app.use(cookieParser());


app.post("/register", (req, res) => {
  const { email, telefono, nombre, contraseña } = req.body;
  if (!email || !telefono || !nombre || !contraseña) {
    return res.status(400).json({ error: "Por favor completa todos los campos" });
  }
  dbUsuarios.get("SELECT * FROM usuarios WHERE email = ?", [email], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Hubo un problema al acceder a la base de datos." });
    }
    if (row) {
      return res.status(409).json({ error: "Ya existe una cuenta registrada con este correo." });
    }
    dbUsuarios.run(
      "INSERT INTO usuarios (email, telefono, nombre, contraseña) VALUES (?, ?, ?, ?)",
      [email, telefono, nombre, contraseña],
      function (err) {
        if (err) {
          return res.status(500).json({ error: "No se pudo registrar el usuario. Intenta nuevamente." });
        }
        res.json({
          mensaje: `¡Bienvenido/a, ${nombre}! Tu registro fue exitoso.`,
          usuario: { email, telefono, nombre }
        });
      }
    );
  });
});

app.post("/login", (req, res) => {
  const { email, contraseña } = req.body;
  if (!email || !contraseña) {
    return res.status(400).json({ error: "Email y contraseña son requeridos." });
  }
  // Buscar usuario en la base de datos
  dbUsuarios.get(
    "SELECT * FROM usuarios WHERE email = ? AND contraseña = ?",
    [email, contraseña],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: "Error en la base de datos." });
      }
      if (!row) {
        return res.status(401).json({ error: "Credenciales incorrectas." });
      }
      const payload = { email };
      const token = jwt.sign(payload, SECRET_KEY, { expiresIn: "1h" });
      res.cookie("token", token, { httpOnly: true, maxAge: 3600000 });
      res.json({ token });
    }
  );
});

app.get("/usuarios", (req, res) => {
  dbUsuarios.all("SELECT id, email, telefono, nombre FROM usuarios", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Error al consultar usuarios." });
    }
    res.json({ usuarios: rows });
  });
});

// Endpoint para crear productos
app.post("/createproduct", (req, res) => {
  const { name, price, rating, description, imageUrl } = req.body;
  if (!name || !price || !rating || !description || !imageUrl) {
    return res.status(400).json({ error: "Todos los campos son requeridos." });
  }
  dbProductos.run(
    "INSERT INTO productos (name, price, rating, description, imageUrl) VALUES (?, ?, ?, ?, ?)",
    [name, price, rating, JSON.stringify(description), imageUrl],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "No se pudo crear el producto." });
      }
      res.json({
        mensaje: "Producto creado exitosamente.",
        producto: { id: this.lastID, name, price, rating, description, imageUrl }
      });
    }
  );
});

// Endpoint para listar productos
app.get("/product", (req, res) => {
  dbProductos.all("SELECT * FROM productos", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Error al consultar productos." });
    }
    // Convertir description de JSON a array
    const productos = rows.map(p => ({
      ...p,
      description: JSON.parse(p.description)
    }));
    res.json({ productos });
  });
});

// Endpoint para obtener un producto por id
app.get("/product/:id", (req, res) => {
  const { id } = req.params;
  dbProductos.get("SELECT * FROM productos WHERE id = ?", [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Error al consultar el producto." });
    }
    if (!row) {
      return res.status(404).json({ error: "Producto no encontrado." });
    }
    // Convertir description de JSON a array
    const producto = {
      ...row,
      description: JSON.parse(row.description)
    };
    res.json({ producto });
  });
});
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

