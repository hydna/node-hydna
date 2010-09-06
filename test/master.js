const spawn = require("parall/worker").spawn



spawn("./worker_reader", 15);
spawn("./worker_writer", 15);